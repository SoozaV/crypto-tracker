import { safeAdd, safeSub, safeMul, safeDiv, formatCrypto, formatMoney, averagePrice } from "./decimalHelper";

let pass = 0, fail = 0;
function eq(label: string, got: string, want: string) {
  if (got === want) { pass++; console.log(`  ✔ ${label} = ${got}`); }
  else { fail++; console.log(`  ✗ ${label}: got ${got}, want ${want}`); }
}

console.log("decimalHelper.ts:");
eq("safeAdd(0.1, 0.2)", safeAdd("0.1", "0.2"), "0.3");        // el bug clásico de float
eq("safeSub(0.3, 0.1)", safeSub("0.3", "0.1"), "0.2");
eq("safeMul(0.5, 40000)", safeMul("0.5", "40000"), "20000");
eq("safeDiv(20010, 0.5)", safeDiv("20010", "0.5"), "40020");
eq("formatCrypto(0.50000000,8)", formatCrypto("0.50000000", 8), "0.5");
eq("formatCrypto(1.23456789012,8)", formatCrypto("1.23456789012", 8), "1.23456789");
eq("formatMoney(20010)", formatMoney("20010"), "20,010.00 USDT");
eq("averagePrice(50000,1)", averagePrice("50000", "1"), "50000");
eq("averagePrice(x,0)=0", averagePrice("123", "0"), "0");

try { safeDiv("1", "0"); fail++; console.log("  ✗ safeDiv por cero no lanzó"); }
catch { pass++; console.log("  ✔ safeDiv(1,0) lanza error"); }

console.log(`\nRESULTADO: ${pass} ok, ${fail} fallos`);
if (fail > 0) process.exit(1);
