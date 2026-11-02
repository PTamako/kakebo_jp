// Print a concise, nonblocking full dependency advisory inventory.
// Production High/Critical vulnerabilities remain blocked by security:audit:prod.
import { spawnSync } from 'node:child_process'
const audit = spawnSync('npm',['audit','--json'],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:90000})
let report
try { report=JSON.parse(audit.stdout||'') } catch {
  console.warn('Dependency advisory inventory unavailable; production security gate still applies')
  process.exit(0)
}
const summary=report.metadata?.vulnerabilities||{}
console.log('DEPENDENCY_AUDIT_SUMMARY',JSON.stringify(summary))
for (const [name,record] of Object.entries(report.vulnerabilities||{})) {
  console.log('DEPENDENCY_AUDIT_ITEM',JSON.stringify({
    name,severity:record.severity,range:record.range,isDirect:record.isDirect,
    fixAvailable:record.fixAvailable
  }))
}
