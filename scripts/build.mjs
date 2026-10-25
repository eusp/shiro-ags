// Empaqueta el shell en un solo .js para gjs, sin el CLI de AGS (que está en Go).
// Replica lo que hacía `ags run`: TS/JSX (jsxImportSource sale de tsconfig.json), los
// .scss compilados con `sass` e importados como texto, y los módulos de GJS
// (gi://, resource://, system...) fuera del paquete.
//
// Uso: node scripts/build.mjs <entrada> <salida>
import { rolldown } from "rolldown"
import ts from "typescript"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

const [infile, outfile] = process.argv.slice(2)
if (!infile || !outfile) {
    console.error("uso: build.mjs <entrada> <salida>")
    process.exit(1)
}

const entry = path.resolve(infile)

// import style from "./style.scss" → el CSS ya compilado, como string
const sass = {
    name: "sass",
    load(id) {
        if (!id.endsWith(".scss")) return null
        const css = execFileSync("sass", [id, "-I", path.dirname(id)], {
            // Con cwd en la carpeta del archivo, sass avisa de una deprecación
            cwd: "/",
            encoding: "utf8",
            stdio: ["ignore", "pipe", "inherit"],
        })
        return { code: `export default ${JSON.stringify(css.trim())}`, moduleType: "js" }
    },
}

// gnim y ags usan decoradores estándar (@register, @property...) que gjs aún no
// entiende y Rolldown no sabe convertir (solo los "legacy"); TypeScript sí.
// También resuelve el JSX con el jsxImportSource de tsconfig.json.
const tsconfig = ts.getParsedCommandLineOfConfigFile(
    path.join(path.dirname(entry), "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
)
const typescript = {
    name: "typescript",
    transform(code, id) {
        if (!/\.[cm]?[jt]sx?$/.test(id)) return null
        const out = ts.transpileModule(code, {
            fileName: id,
            compilerOptions: {
                ...tsconfig?.options,
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
                sourceMap: true,
                noEmit: false,
            },
        })
        return { code: out.outputText.replace(/\n\/\/# sourceMappingURL=.*$/, ""), map: out.sourceMapText, moduleType: "js" }
    },
}

// import x from "inline:./archivo" → el contenido del archivo, como string
const inline = {
    name: "inline",
    resolveId(source, importer) {
        if (!source.startsWith("inline:")) return null
        return "\0inline:" + path.resolve(path.dirname(importer), source.slice(7))
    },
    load(id) {
        if (!id.startsWith("\0inline:")) return null
        return { code: `export default ${JSON.stringify(readFileSync(id.slice(8), "utf8"))}`, moduleType: "js" }
    },
}

const bundle = await rolldown({
    input: entry,
    cwd: path.dirname(entry),
    platform: "neutral",
    external: [/^gi:\/\//, /^resource:\/\//, /^file:\/\//, "system", "console", "cairo", "gettext"],
    transform: {
        target: "es2022",
        define: { SRC: JSON.stringify(path.dirname(entry)) },
    },
    moduleTypes: { ".css": "text" },
    plugins: [sass, inline, typescript],
    logLevel: "warn",
})

// Los decoradores convertidos por TypeScript solo pasan context.metadata (que
// gnim usa para registrar las clases) si existe Symbol.metadata; gjs no lo trae
const banner = `if (!Symbol.metadata) Object.defineProperty(Symbol, "metadata", { value: Symbol.for("Symbol.metadata") });`

await bundle.write({ file: path.resolve(outfile), format: "esm", sourcemap: "inline", banner })
await bundle.close()
