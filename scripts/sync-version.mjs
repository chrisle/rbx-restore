import fs from "node:fs";

const explicit = process.argv.indexOf("--version");
const version = explicit >= 0 ? process.argv[explicit + 1] : process.env.RELEASE_VERSION;

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid release version: ${version ?? "(missing)"}`);
}

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
packageJson.version = version;
fs.writeFileSync("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);

const tauriConfigPath = "src-tauri/tauri.conf.json";
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
tauriConfig.version = version;
fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

const cargoPath = "Cargo.toml";
const cargo = fs.readFileSync(cargoPath, "utf8");
const updatedCargo = cargo.replace(
  /(\[workspace\.package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/,
  `$1"${version}"`,
);
if (updatedCargo === cargo) throw new Error("Cargo workspace version was not found");
fs.writeFileSync(cargoPath, updatedCargo);
