from pathlib import Path

ROOT = Path(__file__).parent
files = {name: (ROOT / name).read_text() for name in [
    'index.html',
    'admission-hub-feature-suite.js',
    'phase2-dictionary-parser.js',
    'phase3-intelligence.js',
    'phase3-question-bank-route.js',
    'phase23-ui.js',
    'master-update.js',
    'study-hub.js',
    'study-tools-restore.js',
    'urgent-fix.js',
    'urgent-topic-fix.js',
    'phase12-ui.js',
    'phase1-upgrade.js',
    'profile-progress-system.js',
    'feature-upgrade-2026.js',
    'profile-reward-update.js',
    'advanced-gamification-v3.js',
    'reward-profile-route-guard.js',
    'routine90.js',
]}

checks = {
    'loading gate exists': 'window.__admissionFinalModulesReady=false' in files['index.html'] and 'class="app-loading"' in files['index.html'],
    'historical Dashboard renderer exposed': '__phase3DashboardMarkup = widgetHTML' in files.get('phase3-intelligence.js', '') if 'phase3-intelligence.js' in files else False,
    'historical Study Hub banner restored': 'sh-dashboard-card' in files.get('study-hub.js', '') and 'dashboard-existing' in files.get('study-hub.js', ''),
    'new Dashboard patch removed': 'dashboard-reference' not in files.get('phase12-ui.js', ''),
    'phase1 carousel dashboard-scoped': "if(currentPath!=='dashboard'&&currentPath!=='home'&&currentPath!=='')return;" in files.get('phase1-upgrade.js', ''),
    'phase23 carousel dashboard-scoped': "if(currentPath!=='dashboard'&&currentPath!=='home'&&currentPath!=='')return;" in files.get('phase23-ui.js', ''),
    'hashchange is final coordinator': 'window.__admissionRenderRoute' in files['index.html'] and 'if(typeof window.__admissionRenderRoute===\'function\') window.__admissionRenderRoute();' in files['index.html'],
    'single render lock exists': 'window.__admissionFinalRenderLock' in files['index.html'],
    'parser final renderer exposed': 'window.renderQuestionParser' in files['admission-hub-feature-suite.js'],
    'parser legacy timeout removed': "else if ((Router.path || '') === 'question-parser') renderParserHome()" not in files['phase2-dictionary-parser.js'],
    'qbank helper does not manually render': "location.hash='#question-bank/subject/'+encodeURIComponent(id);renderAuthoritative" not in files['phase3-question-bank-route.js'],
    'special navigation does not manually render': 'return window.render()' not in files['master-update.js'] and 'renderWebChatV2(); else renderDictionaryV2();' not in files['phase23-ui.js'],
    'dashboard duplicate card injection removed': 'page.insertBefore(section, page.firstChild || null)' not in files['study-hub.js'],
    'legacy urgent boot repaint removed': 'renderAfterBoot' not in files['urgent-fix.js'],
    'legacy topic route delegates to final qbank': 'window.renderQuestionBankV2' in files['urgent-topic-fix.js'],
    'progress extras are synchronous': 'window.__phase3ProgressExtras' in files['phase3-intelligence.js'] and "setTimeout(()=>{if(p==='dashboard')injectDashboard" not in files['phase3-intelligence.js'],
    'no destructive startup cleanup restored': 'purgeDuplicateGeneralTopics' in files['index.html'] and 'changed:false' in files['index.html'],
    'Profile module loaded before coordinator': 'profile-progress-system.js?v=1' in files['index.html'] and 'window.__admissionIntegratedProfileRender' in files['profile-progress-system.js'],
    'Profile replaces bottom Progress nav': "{key:'profile', icon:'👤', label:'Profile'}" in files['index.html'] and "path.startsWith('profile')||path.startsWith('progress')" in files['index.html'],
    'Profile and legacy Progress share final route': "p === 'profile' || p === 'progress'" in files['index.html'],
    'Profile has exactly 50-level engine': 'Array.from({ length: 50 }' in files['profile-progress-system.js'] and 'levels.length' not in files['profile-progress-system.js'],
    'Profile persists additive profileV1 only': 'profileV1' in files['profile-progress-system.js'] and "dbPut('settings', s)" in files['profile-progress-system.js'] and 'indexedDB.deleteDatabase' not in files['profile-progress-system.js'] and 'localStorage.clear' not in files['profile-progress-system.js'],
    'Profile uses existing analytics sources': 'computeLifetimeStats' in files['profile-progress-system.js'] and 'CACHE?.examResults' in files['profile-progress-system.js'] and 'CACHE?.mistakes' in files['profile-progress-system.js'] and 'Math.random' not in files['profile-progress-system.js'],
    'Profile demo sections present': all(marker in files['profile-progress-system.js'] for marker in ['OVERALL ADMISSION PROGRESS','YOUR STUDY COMPANION','LEVEL JOURNEY','LOCKED LEVEL PREVIEW','Customize Profile','Weak Areas','Achievements']),
    'Profile demo controls present': all(marker in files['profile-progress-system.js'] for marker in ['setAdmissionProgressPeriod','setAdmissionAchievementFilter','setAdmissionCustomizePart','PROFILE_BACKGROUNDS','admission-profile-roadmap']),
    'feature Profile wrapper defers': '__admissionIntegratedProfileRender' in files['feature-upgrade-2026.js'],
    'legacy Profile wrapper defers': '__admissionIntegratedProfileRender' in files['profile-reward-update.js'],
    'advanced Profile timer defers': '__admissionIntegratedProfileRender' in files['advanced-gamification-v3.js'],
    'route guard skips integrated Profile': "if (p === 'profile') return false;" in files['reward-profile-route-guard.js'],
    'routine90 keeps existing planner shell': 'function shell(){' in files['routine90.js'] and '.r90-day' in files['routine90.js'] and '90 Day Planner' in files['routine90.js'],
    'routine90 defaults to one card': 'state.showAll=false' in files['routine90.js'] and 'currentDayNumber()' in files['routine90.js'] and 'state.showAll?all' in files['routine90.js'] and 'data-action="morecards"' in files['routine90.js'],
    'routine90 default subjects exact': "['Bangla 1st','Bangla 2nd','English 2nd','Memorizing','বিরচন','GK']" in files['routine90.js'],
    'routine90 topic-only parser': 'function parseDayTopics' in files['routine90.js'] and 'function applyParsedPlan' in files['routine90.js'] and 'data-action="parse"' in files['routine90.js'] and 'Day 1' in files['routine90.js'],
    'routine90 parser is additive local storage': "var STORE_KEY = 'routine90_data'" in files['routine90.js'] and 'indexedDB.deleteDatabase' not in files['routine90.js'] and 'localStorage.clear' not in files['routine90.js'],
}

for label, passed in checks.items():
    print(f'{label}: {"PASS" if passed else "FAIL"}')

if not all(checks.values()):
    raise SystemExit(1)
print('duplicate-ui QA: PASS')
