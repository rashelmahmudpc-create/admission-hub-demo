from pathlib import Path

root = Path(__file__).parent
index = (root / "index.html").read_text(encoding="utf-8")
module = (root / "study-hub.js").read_text(encoding="utf-8")

required = [
    "study-hub.js?v=2",
    "data-study-hub-dashboard-card",
    "Mistake Book",
    "Revision",
    "Bookmarks",
    "Quick Notes",
    "Focus Timer",
    "Exam Countdown",
    "id: 'mistake-book'",
    "id: 'revision'",
    "id: 'bookmarks'",
    "id: 'quick-notes'",
    "id: 'focus-timer'",
    "id: 'exam-countdown'",
    "localStorage",
]
missing = [item for item in required if item not in module and item not in index]
assert not missing, f"Missing required Study Hub markers: {missing}"
assert "Study Hub" not in index.split("const NAV_TABS", 1)[1].split("function baseTab", 1)[0], "Study Hub must not be a bottom-nav tab"
assert "study-hub.js?v=2" in index, "Versioned Study Hub module is not referenced"
assert "studyHubRender" in module and "window.render = studyHubRender" in module, "Study Hub route wrapper missing"
print("Study Hub static QA passed")
print(f"Module lines: {len(module.splitlines())}; required markers: {len(required)}")
