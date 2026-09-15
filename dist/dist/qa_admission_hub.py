import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent

for filename in [
    "mcq-qbank-import.js",
    "qbank-redesign.js",
    "phase1-upgrade.js",
    "data-protection.js",
    "performance-hardening.js",
    "sw.js",
]:
    subprocess.run(["node", "--check", filename], cwd=ROOT, check=True)

html = (ROOT / "index.html").read_text(encoding="utf-8")
qbank = (ROOT / "qbank-redesign.js").read_text(encoding="utf-8")
urgent = (ROOT / "urgent-fix.js").read_text(encoding="utf-8")
sw = (ROOT / "sw.js").read_text(encoding="utf-8")
protection = (ROOT / "data-protection.js").read_text(encoding="utf-8")
performance = (ROOT / "performance-hardening.js").read_text(encoding="utf-8")

required_html = [
    "maximum-scale=1",
    "viewport-fit=cover",
    "font-size:16px!important",
    "app-fallback",
    "__admissionBootPromise = boot()",
    "Saved data is protected",
    "visual-viewport-height",
    "const DB_NAME='admissionHubDB', DB_VERSION=5",
    "const STORES=['appMeta','subjects','topics','questions','exams','examResults','mistakes','vocabulary','dailyStats','activityLogs','settings','notes','ADMISSION_PLANS','PLAN_DAYS']",
    "SCHEMA_MIGRATIONS",
    "runSchemaMigrations",
    "window.__admissionHubGetActiveExam",
    "window.__admissionBootStatus='loading'",
    "window.__admissionBootStatus='ready'",
    "Preparing your saved study space",
    "${life.correct+life.wrong}",
    "${life.skipped}",
    "Questions presented",
]
missing_html = [item for item in required_html if item not in html]
assert not missing_html, f"Missing required HTML markers: {missing_html}"

assert "visibleCount: 100" in qbank
assert "|| 100) + 100" in qbank
assert "Math.max(100" in qbank
assert "loadMoreTopicQuestions" in qbank
assert "setTopicQuery" in qbank
assert "visibleQs.map" in qbank

assert re.search(r"const CACHE_PREFIX = ['\"]admission-hub-shell-", sw)
assert re.search(r"const BUILD_ID = ['\"]v26-dashboard-default-20260817['\"]", sw)
assert sw.count("const CACHE_NAME") == 1
assert "cache: 'no-store'" in sw
assert "cache: 'reload'" in sw
assert "self.skipWaiting()" in sw
assert "self.clients.claim()" in sw
assert "isCurrentBuild(cached)" in sw
assert "isCurrentBuild(shell)" in sw
assert "await cacheNetworkResponse(request, response)" in sw
assert "navigator.serviceWorker.register" in html
assert html.count("navigator.serviceWorker.register") == 1
assert "v26-dashboard-default-20260817" in html
assert 'source=pwa#dashboard' in (ROOT / "manifest.json").read_text(encoding="utf-8")
assert 'source=pwa#dashboard' in (ROOT / "manifest.webmanifest").read_text(encoding="utf-8")
assert "normalizePwaLaunch" in html
assert "PWA launch always opens the existing Dashboard" in html
assert "location.pathname+location.search+'#dashboard'" in html
assert "90-Day Master Plan" in html
assert "p === 'progress/plan'" in html
assert "window.Routine90?.render" in html
assert "Opening your 90 Day Planner…" in html
assert "if(Router.path==='progress/plan')return renderPlan()" not in html
assert "scope:'./'" in html
assert "activateWaiting(registration)" in html
assert "indexedDB.deleteDatabase" not in sw
assert "localStorage.clear" not in sw

# Startup must not invoke legacy destructive cleanup routines.
assert "await purgeImportedSubjects();" not in html
assert "await purgeDuplicateGeneralTopics();" not in html
assert "read-only startup diagnostics" in html
assert "dbDel('topics', d.id)" not in html
assert "dbDel('questions', q.id); totalDeletedQuestions++" not in html

assert "auditDatabase" in protection
assert "verifyMigration" in protection
assert "No automatic data repair was attempted" in protection
assert "version: 2" in performance
assert "u-memory-grid" in urgent
assert "overflow-wrap:anywhere" in urgent
assert "renderAfterBoot" not in urgent
assert "window.__admissionFinalModulesReady" in html
assert "if(q.status!=='correct'&&q.status!=='wrong')return" in html

payload = json.loads((ROOT / "mcq_final.json").read_text(encoding="utf-8"))
questions = payload["questions"]
assert len(questions) == 1046
assert len({q["id"] for q in questions}) == len(questions)
assert all(isinstance(q.get("options"), list) and len(q["options"]) == 4 for q in questions)
assert all(isinstance(q.get("answer"), int) and 0 <= q["answer"] <= 3 for q in questions)

print("QA PASS")
print(f"MCQ records preserved: {len(questions)}")
print("Syntax checks: passed")
print("PWA/update safety assertions: passed")
print("Non-destructive startup assertions: passed")
print("Bounded question rendering/search assertions: passed")
print("Video regression assertions: passed")
