SEASON_TYPE = 2 // 1 = pre-season; 2 = regular season; 3 = post-season
WEEK = 9
YEAR = 2026

// NOTIFY_SUBSCRIBERS = false
NOTIFY_SUBSCRIBERS = true

LOCK_FORM = false
// LOCK_FORM = true

AUTOMATE = true
// AUTOMATE = false

NFL_SCHEDULE_URL = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=1000&dates=" + YEAR + "&seasontype=" + SEASON_TYPE + "&week=" + WEEK

MASTER_SHEET_ID = "11M4rKFoVnsg9fXxB1hvHOHs4cX57ihmuv2DJM5TOUUE"
MASTER_FORM_ID = "1WrDhpwBtOeq7uf4AlDqV-W9EZRpxDLCrfurX11qiNns"

STANDINGS_SHEET_ID = "1kZVUh8ONbAIBvd3lGQkQP6j9kjXS8coqZZoecQwvl9s"

MAILING_SHEET_ID = "1aF6nF4oDeXnFbS-2GLMC-HT2pb-B_MkBjk8-pvAYdJE"
MAILING_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxnjRR6Qk3jQfxjCE-0QpksOPn66NYu9_dT8JOMXMG9zgM3BcXwyETHDyZCNZPVtTDX/exec"
SITE_URL = "https://sites.google.com/view/pickemetrics/home"

WEEK_NAME = "Week " + WEEK
SCORE_MULTIPLIER = 1

if (SEASON_TYPE === 1) {
  WEEK_NAME = "Preseason " + WEEK_NAME
} else if (SEASON_TYPE === 3) {
  WEEK_NAME = "Postseason " + WEEK_NAME
  SCORE_MULTIPLIER += WEEK
}

function main() {
  updateMasterSheet();
  var schedule = getEspnSchedule();
  generateForm(schedule);
  if (NOTIFY_SUBSCRIBERS) {
    sendWeeklyPickReminder();
  }
}

function automatedScripts() {
  if (AUTOMATE) {
    getLiveEspnData();
    pendingScoreAndMaxRank();
    seasonStandings();
  }
}

function debug() {
  // var schedule = getEspnSchedule();
  // previewForm(schedule);
  
  var i = 0;
}
