const css = await Bun.file(new URL("../styles.css", import.meta.url)).text();
const failures: string[] = [];

if (!css.includes("min-width: 0")) failures.push("mobile comparison must be allowed to shrink with min-width: 0");
if (!css.includes("overflow-wrap: anywhere")) failures.push("long CI references need overflow-wrap: anywhere");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Responsive source proxy passed. Real browser measurement is still required.");
