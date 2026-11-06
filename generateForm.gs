// Maps the team nickname (as it appears in your schedule data) to the
// abbreviation used by ESPN's public logo CDN and site API. NFL.com does
// not expose a stable, script-fetchable logo URL, so this uses ESPN's CDN
// instead, which hosts the same official team logos at predictable URLs.
// This same abbreviation is reused below to look up each team's roster for
// QB headshots, so it only needs to be maintained in one place.
var TEAM_LOGO_MAP = {
  "Cardinals": "ari",
  "Falcons": "atl",
  "Ravens": "bal",
  "Bills": "buf",
  "Panthers": "car",
  "Bears": "chi",
  "Bengals": "cin",
  "Browns": "cle",
  "Cowboys": "dal",
  "Broncos": "den",
  "Lions": "det",
  "Packers": "gb",
  "Texans": "hou",
  "Colts": "ind",
  "Jaguars": "jax",
  "Chiefs": "kc",
  "Raiders": "lv",
  "Chargers": "lac",
  "Rams": "lar",
  "Dolphins": "mia",
  "Vikings": "min",
  "Patriots": "ne",
  "Saints": "no",
  "Giants": "nyg",
  "Jets": "nyj",
  "Eagles": "phi",
  "Steelers": "pit",
  "49ers": "sf",
  "Seahawks": "sea",
  "Buccaneers": "tb",
  "Titans": "ten",
  "Commanders": "wsh"
};

// In-memory cache so a bye week or two teams sharing a script run never
// means fetching the same team's roster twice in one execution.
// Fetches a team's roster JSON from ESPN's public site API. Returns null —
// rather than throwing — on any failure, so a QB headshot lookup can never
// break form generation.
function getTeamRoster_(abbr) {
  var url = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/" + abbr + "/roster";
  try {
    var response = UrlFetchApp.fetch(url);
    if (response.getResponseCode() === 200) {
      return JSON.parse(response.getContentText());
    }
    Logger.log("Roster fetch failed for " + abbr + " (HTTP " + response.getResponseCode() + ")");
  } catch (e) {
    Logger.log("Error fetching roster for " + abbr + ": " + e);
  }
  return null;
}

// Looks up a team's current overall record from ESPN's team endpoint and
// returns it as "W-L-T" (e.g. "6-2-0"). ESPN omits the tie count when it's
// zero, so this pads it. Cached per run; returns null (never throws) on any
// failure so a bad lookup just leaves the record off the title.
var TEAM_RECORD_CACHE_ = {};

function getTeamRecord_(teamName) {
  if (teamName in TEAM_RECORD_CACHE_) return TEAM_RECORD_CACHE_[teamName];

  var abbr = TEAM_LOGO_MAP[teamName];
  var record = null;

  if (abbr) {
    try {
      var response = UrlFetchApp.fetch(
        "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/" + abbr,
        { muteHttpExceptions: true }
      );
      if (response.getResponseCode() === 200) {
        var items = JSON.parse(response.getContentText()).team.record.items || [];
        var total = items.find(function(r) { return r.type === "total"; }) || items[0];
        if (total && total.summary) {
          var parts = total.summary.split("-");   // "6-2" or "6-2-1"
          while (parts.length < 3) parts.push("0");
          record = parts.slice(0, 3).join("-");
        }
      } else {
        Logger.log("Record fetch failed for " + teamName + " (HTTP " + response.getResponseCode() + ")");
      }
    } catch (e) {
      Logger.log("Error fetching record for " + teamName + ": " + e);
    }
  }

  TEAM_RECORD_CACHE_[teamName] = record;
  return record;
}

// ---------------------------------------------------------------------
// STARTING QB HEADSHOTS
// ---------------------------------------------------------------------
// Unlike team logos (which never change), a team's starting QB can change
// week to week — byes aside, injuries, benchings and trades all move this.
// So instead of hardcoding a player/image ID that would silently go stale,
// this maps each team to the *name* of its current starter (easy to read
// and update from any NFL news article) and looks that name up against
// ESPN's live team roster at generation time, pulling whatever headshot
// ESPN currently has on file for that player. If a name here doesn't match
// anyone on the roster (a typo, a spelling ESPN doesn't share, a rookie
// who was just called up), that QB's headshot is silently skipped — it
// never blocks the rest of form generation, same as a missing logo.
//
// >>> UPDATE THIS EVERY WEEK, BEFORE RUNNING generateForm() <<<
// Set each team to whoever is *this week's* starter. Spelling doesn't need
// to be exact (matching ignores punctuation/case and allows partial
// matches), but keep it recognizably close to how ESPN lists the player.
//
// Filled in as of the current NFL week; double-check any team with a
// live QB competition (marked below) before you run this for real.
var STARTING_QB_MAP = {
  "Cardinals": "Jacoby Brissett",
  "Falcons": "Michael Penix Jr.",
  "Ravens": "Lamar Jackson",
  "Bills": "Josh Allen",
  "Panthers": "Bryce Young",
  "Bears": "Caleb Williams",
  "Bengals": "Joe Burrow",
  "Browns": "Deshaun Watson",
  "Cowboys": "Dak Prescott",
  "Broncos": "Bo Nix",
  "Lions": "Jared Goff",
  "Packers": "Jordan Love",
  "Texans": "C.J. Stroud",
  "Colts": "Daniel Jones",
  "Jaguars": "Trevor Lawrence",
  "Chiefs": "Patrick Mahomes",
  "Raiders": "Kirk Cousins",
  "Chargers": "Justin Herbert",
  "Rams": "Matthew Stafford",
  "Dolphins": "Malik Willis",
  "Vikings": "Kyler Murray",
  "Patriots": "Drake Maye",
  "Saints": "Tyler Shough",
  "Giants": "Jameis Winston",
  "Jets": "Geno Smith",
  "Eagles": "Jalen Hurts",
  "Steelers": "Aaron Rodgers",
  "49ers": "Brock Purdy",
  "Seahawks": "Sam Darnold",
  "Buccaneers": "Baker Mayfield",
  "Titans": "Cam Ward",
  "Commanders": "Jayden Daniels"
};

// Strips everything but letters and lowercases, so "C.J. Stroud" and
// "CJ Stroud" (or "Michael Penix Jr." and "Michael Penix") compare equal.
function normalizeName_(name) {
  return (name || "").toLowerCase().replace(/[^a-z]/g, "");
}

// Live-fetches the QB1 name off a team's current ESPN depth chart (not the
// roster endpoint — a depth chart is ranked and reflects who's actually
// starting, where a roster is just an unranked player list). Returns null
// — never throws — on any failure (network error, unexpected response
// shape, no QB listed), so a bad fetch just falls back to STARTING_QB_MAP
// downstream.
function getLiveStartingQbName_(abbr) {
  try {
    var response = UrlFetchApp.fetch("https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/" + abbr + "/depthcharts");
    var json = JSON.parse(response.getContentText());
    var subteam_rosters = json.depthchart;
    var starting_qb = subteam_rosters.find(team => team.positions?.qb?.athletes?.length > 0)?.positions?.qb?.athletes[0]?.displayName;
    return starting_qb || null;
  } catch (e) {
    Logger.log("Live depth chart lookup failed for " + abbr + ": " + e);
    return null;
  }
}

// Resolves a team's starting QB name once per run: live ESPN depth chart
// first, STARTING_QB_MAP only as a fallback. Cached so the title and the
// headshot lookup share one fetch and always agree.
var QB_NAME_CACHE_ = {};

function getStartingQbName_(teamName) {
  if (teamName in QB_NAME_CACHE_) return QB_NAME_CACHE_[teamName];

  var abbr = TEAM_LOGO_MAP[teamName];
  var name = null;

  if (abbr) {
    var liveName = getLiveStartingQbName_(abbr);
    var mappedName = STARTING_QB_MAP[teamName];

    if (liveName && mappedName && normalizeName_(liveName) !== normalizeName_(mappedName)) {
      Logger.log("STARTING_QB_MAP is stale for the " + teamName + ": map says '" +
                 mappedName + "', live depth chart says '" + liveName + "'.");
    }
    name = liveName || mappedName || null;
  }

  QB_NAME_CACHE_[teamName] = name;
  return name;
}

// Looks up the headshot URL ESPN currently has on file for a team's
// starting QB. Prefers the LIVE depth chart's QB1 (see
// getLiveStartingQbName_) over the hand-maintained STARTING_QB_MAP, since
// the depth chart reflects reality without needing a weekly manual update.
// If the live name disagrees with STARTING_QB_MAP, that mismatch is logged
// — so you notice and can update the map — but the live name still wins
// for this run. STARTING_QB_MAP is used only as a fallback when the live
// lookup fails outright.
// Returns null if neither source has a usable name, the roster fetch
// fails, or no QB on the roster matches the resolved name closely enough.
function getQbHeadshotUrl_(teamName) {
  var abbr = TEAM_LOGO_MAP[teamName];
  if (!abbr) return null;

  var qbName = getStartingQbName_(teamName);
  if (!qbName) return null;

  var roster = getTeamRoster_(abbr);
  if (!roster || !roster.athletes) return null;

  var target = normalizeName_(qbName);
  var qbCandidates = [];

  roster.athletes.forEach(function(group) {
    (group.items || []).forEach(function(athlete) {
      var posAbbr = athlete.position && athlete.position.abbreviation;
      if (posAbbr === "QB") qbCandidates.push(athlete);
    });
  });

  for (var i = 0; i < qbCandidates.length; i++) {
    var athlete = qbCandidates[i];
    var candidateName = normalizeName_(athlete.displayName || athlete.fullName);
    if (candidateName === target ||
        candidateName.indexOf(target) !== -1 ||
        target.indexOf(candidateName) !== -1) {
      return athlete.headshot && athlete.headshot.href;
    }
  }

  Logger.log("No roster match for QB '" + qbName + "' on the " + teamName +
             " (checked " + qbCandidates.length + " QB(s) on the roster) — " +
             "update STARTING_QB_MAP or check the spelling.");
  return null;
}

// Fetches a starting QB's headshot as a Blob. Returns null (rather than
// throwing) if anything above fails, so a bad/missing headshot never
// breaks form generation — matches the behavior of getTeamLogoBlob.
function getQbHeadshotBlob(teamName) {
  var url = getQbHeadshotUrl_(teamName);
  if (!url) return null;

  try {
    var response = UrlFetchApp.fetch(url);
    if (response.getResponseCode() === 200) {
      return response.getBlob().setName(teamName + "_qb.png");
    }
    Logger.log("QB headshot fetch failed for " + teamName + " (HTTP " + response.getResponseCode() + ")");
  } catch (e) {
    Logger.log("Error fetching QB headshot for " + teamName + ": " + e);
  }
  return null;
}

// Fetches a team's logo as a Blob from ESPN's CDN. Returns null (rather than
// throwing) if the team isn't in the map or the fetch fails, so a bad/missing
// logo never breaks form generation.
function getTeamLogoBlob(teamName) {
  var abbr = TEAM_LOGO_MAP[teamName];
  if (!abbr) {
    Logger.log("No logo mapping found for team: " + teamName);
    return null;
  }

  var url = "https://a.espncdn.com/i/teamlogos/nfl/500/" + abbr + ".png";

  try {
    var response = UrlFetchApp.fetch(url);
    if (response.getResponseCode() === 200) {
      return response.getBlob().setName(teamName + "_logo.png");
    } else {
      Logger.log("Logo fetch failed for " + teamName + " (HTTP " + response.getResponseCode() + ")");
    }
  } catch (e) {
    Logger.log("Error fetching logo for " + teamName + ": " + e);
  }

  return null;
}

// Builds one combined "Away QB + Away Logo @ Home Logo + Home QB" image per
// matchup, using a single temporary Slides presentation (one slide per game)
// so we only create/delete one file total instead of one per game. NOTE:
// the Slides API does not support a custom page size (Slides.Presentations.create()
// silently ignores a pageSize field, and there is no request to resize a
// page afterward), so every slide is the standard 720x405pt canvas. The
// artwork is laid out as two rows (QBs on top, logos/@ below — see the
// comment inside the function) so its proportions are close enough to that
// fixed 16:9 canvas to fill most of it, rather than leaving most of the
// canvas blank the way a single flat row of four squares would. Returns an
// object mapping the schedule column index -> image Blob. Returns {} (and
// logs why) if anything fails, e.g. the Slides API advanced service isn't
// enabled yet — callers should treat a missing entry as "no composite image
// available".
function buildMatchupImageBlobs(schedule) {
  var awayTeams = schedule[3];
  var homeTeams = schedule[4];

  // Only real matchup columns have both an away and home team (not "-").
  var matchupIndices = [];
  for (var i = 1; i < awayTeams.length; i++) {
    if (awayTeams[i] !== "-" && homeTeams[i] !== "-") {
      matchupIndices.push(i);
    }
  }

  if (matchupIndices.length === 0) return {};

  var blobsByIndex = {};
  var presentation;

  try {
    presentation = SlidesApp.create("TEMP_matchup_combos_" + Utilities.getUuid());
    var pageWidth = presentation.getPageWidth();   // 720pt on a standard slide
    var pageHeight = presentation.getPageHeight(); // 405pt on a standard slide

    // Laid out as two rows instead of one flat row of four. A single row
    // of 4 square images is much wider than it is tall, but every slide is
    // stuck at a fixed 720x405 (16:9) canvas — so at the largest square
    // size that fits the width, most of that height goes unused no matter
    // how "big" the images are. Two rows brings the composite's overall
    // shape close enough to 16:9 that both width AND height end up mostly
    // filled:
    //   Top row:    Away QB           Home QB
    //   Bottom row: Away Logo    @    Home Logo
    // Each QB sits directly above its own team's logo (same x, same size),
    // so it still reads left-to-right as away-vs-home.
    var margin = 6;
    var rowGap = 12; // vertical gap between the QB row and the logo/@ row
    var gap = 34;    // fixed width for the "@" symbol between the two logos

    var imgSize = Math.min(
      (pageWidth - margin * 2 - gap) / 2,
      (pageHeight - margin * 2 - rowGap) / 2
    ); // small shrink so images don't butt right up against each other

    var rowWidth = (imgSize * 2) + gap;
    var startX = (pageWidth - rowWidth) / 2;
    var totalHeight = (imgSize * 2) + rowGap;
    var topY = (pageHeight - totalHeight) / 2;  // top of the QB row
    var bottomY = topY + imgSize + rowGap;      // top of the logo/@ row

    var xAway = startX;               // shared x for away QB + away logo
    var xHome = startX + imgSize + gap; // shared x for home QB + home logo
    var xAt = startX + imgSize;         // "@" sits between the two logos

    // Reuse the presentation's default first slide, add one blank slide per
    // additional matchup.
    var slides = [presentation.getSlides()[0]];
    for (var s = 1; s < matchupIndices.length; s++) {
      slides.push(presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK));
    }

    matchupIndices.forEach(function(idx, s) {
      var slide = slides[s];
      slide.getShapes().forEach(function(shape) { shape.remove(); }); // clear placeholders

      var awayTeam = awayTeams[idx];
      var homeTeam = homeTeams[idx];

      var awayQbBlob = getQbHeadshotBlob(awayTeam);
      var awayLogoBlob = getTeamLogoBlob(awayTeam);
      var homeLogoBlob = getTeamLogoBlob(homeTeam);
      var homeQbBlob = getQbHeadshotBlob(homeTeam);

      if (awayQbBlob) {
        slide.insertImage(awayQbBlob, xAway, topY, imgSize, imgSize);
      }
      if (awayLogoBlob) {
        slide.insertImage(awayLogoBlob, xAway, bottomY, imgSize, imgSize);
      }

      var atBox = slide.insertTextBox("@", xAt, bottomY + (imgSize / 2) - 22, gap, 44);
      atBox.getText().getTextStyle().setFontSize(24).setBold(true);
      atBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

      if (homeLogoBlob) {
        slide.insertImage(homeLogoBlob, xHome, bottomY, imgSize, imgSize);
      }
      if (homeQbBlob) {
        slide.insertImage(homeQbBlob, xHome, topY, imgSize, imgSize);
      }
    });

    presentation.saveAndClose();
    var fileId = presentation.getId();

    // Fetch each slide as a PNG thumbnail and store it against its column index.
    matchupIndices.forEach(function(idx, s) {
      try {
        var slideId = slides[s].getObjectId();
        var thumbnail = Slides.Presentations.Pages.getThumbnail(fileId, slideId, {
          "thumbnailProperties.thumbnailSize": "LARGE"
        });
        var response = UrlFetchApp.fetch(thumbnail.getContentUrl(), {
          headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
          muteHttpExceptions: true
        });
        if (response.getResponseCode() === 200) {
          blobsByIndex[idx] = response.getBlob().setName("matchup_" + idx + "_images.png");
        } else {
          Logger.log("Thumbnail fetch failed for matchup index " + idx + " (HTTP " + response.getResponseCode() + ")");
        }
      } catch (e) {
        Logger.log("Could not generate composite image for matchup index " + idx + ": " + e);
      }
    });

    DriveApp.getFileById(fileId).setTrashed(true); // clean up the temp file

  } catch (e) {
    Logger.log("Composite image generation failed — is the Slides API advanced service enabled? " + e);
    if (presentation) {
      try { DriveApp.getFileById(presentation.getId()).setTrashed(true); } catch (cleanupError) { /* ignore */ }
    }
    return {};
  }

  return blobsByIndex;
}

// Builds all the question items (name field, matchups + images, tiebreaker,
// weekly double) onto whatever Form is passed in. Shared by both the live
// generateForm() and the throwaway previewForm(), so preview mode can never
// drift out of sync with what actually gets published.
function buildFormItems(form, schedule, masterSpreadsheet) {
  var titles = schedule[0];
  var favorites = schedule[1];
  var favoritesProbs = schedule[2];
  var awayTeams = schedule[3];
  var homeTeams = schedule[4];
  titles[0] = "What is your name?";

  var firstGameTime = titles[1].match(/\(([^)]+)\)/)[0]; // Get time of first game from parentheses of first title

  form.setTitle("NFL " + WEEK_NAME + " Pick 'Em")
  form.setDescription("Get your picks in before the first game this week " + firstGameTime + ".\n\nEach correct pick is worth " + SCORE_MULTIPLIER + " points.\n\nView this week's live standings here:\n" + masterSpreadsheet.getUrl().replace("/edit", ""));
  form.setAcceptingResponses(true);

  // WIPE OLD RESPONSES & QUESTIONS
  form.deleteAllResponses();
  form.getItems().forEach(item => form.deleteItem(item));

  // Build all combined "Away QB + Away Logo @ Home Logo + Home QB" images up
  // front, in one temp file.
  var matchupImageBlobs = buildMatchupImageBlobs(schedule);

  // Loop through each column to create questions
  var matchupList = [];

  for (var i = 0; i < titles.length; i++) {
    var title = titles[i];
    var favorite = favorites[i];
    var favoritesProb = favoritesProbs[i];
    var awayTeam = awayTeams[i];
    var homeTeam = homeTeams[i];

    
    // CASE 1: The First Column ("What is your name?")
    if (i === 0) {
      form.addTextItem().setTitle(title).setRequired(true);
    } 
    // CASE 2: The Last Column (Tiebreaker)
    // We check if the options are both "-"
    else if (awayTeam === "-" && homeTeam === "-") {
      // Build the validation rule: Must be Number >= 0
      var validation = FormApp.createTextValidation().requireNumberGreaterThanOrEqualTo(0).requireNumberLessThanOrEqualTo(100).build();
      
      var item = form.addTextItem().setTitle(title).setRequired(true).setValidation(validation);

      if (favorite !== "") {
        item.setHelpText("The expected number of points to be scored in this game is " + favorite + ".");
      }
    } 
    // CASE 3: Game Matchups (Multiple Choice)
    else {
      // One small combined image (both QBs + both logos) above the question.
      // Falls back to separate QB/logo images only if the composite image
      // couldn't be built (e.g. Slides API isn't enabled yet).
      var comboImage = matchupImageBlobs[i];
      if (comboImage) {
        var awayQbName = getStartingQbName_(awayTeam);
        var homeQbName = getStartingQbName_(homeTeam);
        var awayRecord = getTeamRecord_(awayTeam);
        var homeRecord = getTeamRecord_(homeTeam);

        // (QB Away) Away (W-L-T) @ Home (W-L-T) (QB Home)
        var comboTitle = (awayQbName ? "(" + awayQbName + ") " : "") +
                        awayTeam + (awayRecord ? " (" + awayRecord + ")" : "") +
                        " @ " +
                        homeTeam + (homeRecord ? " (" + homeRecord + ")" : "") +
                        (homeQbName ? " (" + homeQbName + ")" : "");

        form.addImageItem()
          .setImage(comboImage)
          .setTitle(comboTitle)
          .setWidth(320);
      } else {
        var awayQbBlob = getQbHeadshotBlob(awayTeam);
        if (awayQbBlob) {
          form.addImageItem().setImage(awayQbBlob).setWidth(60);
        }
        var awayLogo = getTeamLogoBlob(awayTeam);
        if (awayLogo) {
          form.addImageItem().setImage(awayLogo).setWidth(60);
        }
        var homeLogo = getTeamLogoBlob(homeTeam);
        if (homeLogo) {
          form.addImageItem().setImage(homeLogo).setWidth(60);
        }
        var homeQbBlob = getQbHeadshotBlob(homeTeam);
        if (homeQbBlob) {
          form.addImageItem().setImage(homeQbBlob).setWidth(60);
        }
      }

      var item = form.addMultipleChoiceItem();
      item.setTitle(title)
          .setRequired(true)
          .setChoices([
            item.createChoice(awayTeam + " (Away)"), // First option (Away Team)
            item.createChoice(homeTeam + " (Home)")  // Second option (Home Team)
          ]);
      
      if (favorite !== "") {
        item.setHelpText("The " + favorite + " are favored to win with a probability of " + favoritesProb + ".");
      }

      matchupList.push(title + " " + awayTeam + " @ " + homeTeam);
    }
  }

  // Weekly Double
  var item = form.addMultipleChoiceItem();
  item.setTitle("Weekly Double")
      .setRequired(true)
      .setHelpText("Select which game this week you want to be worth double points.\nThis selection only applies to your own scoring.\nEveryone may choose their own Weekly Double game.")
      .setChoices(matchupList.map(m => item.createChoice(m)));
}

// PREVIEW MODE: builds the exact same questions/images onto a brand-new,
// throwaway Form. Does NOT touch MASTER_FORM_ID, does NOT write to the
// "Game Results" sheet, and does NOT relink/rename any spreadsheet tabs.
// Run this, check the Execution Log for the URL, open it, and delete the
// temp form (or leave it — it's not linked to anything live) when done.
//
// This is also the easiest way to sanity-check STARTING_QB_MAP each week:
// the Execution Log will call out any team whose mapped QB name didn't
// match anyone on that team's roster, before you touch the live form.
function previewForm(schedule) {
  var masterSpreadsheet = SpreadsheetApp.openById(MASTER_SHEET_ID);

  var previewForm = FormApp.create("PREVIEW - NFL " + WEEK_NAME + " Pick 'Em");
  buildFormItems(previewForm, schedule, masterSpreadsheet);

  Logger.log("Preview form (edit view): " + previewForm.getEditUrl());
  Logger.log("Preview form (respondent view): " + previewForm.getPublishedUrl());
}

function generateForm(schedule) {
  var masterSpreadsheet = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var gameResultsSheet = masterSpreadsheet.getSheetByName("Game Results");

  // Write to Rows 3, 4, 5, 6, and 7 starting in column A
  gameResultsSheet.getRange(3, 1, schedule.length, schedule[0].length).setValues(schedule);

  // Create/update the live form
  var masterForm = FormApp.openById(MASTER_FORM_ID);
  buildFormItems(masterForm, schedule, masterSpreadsheet);

  // 5. LINK TO MAIN SHEET & IDENTIFY THE NEW TAB
  var sheetsBefore = masterSpreadsheet.getSheets().map(s => s.getSheetId());
  
  // Unlink from the old sheet and Relink to the new sheet
  masterForm.removeDestination();
  masterForm.setDestination(FormApp.DestinationType.SPREADSHEET, MASTER_SHEET_ID);
  
  SpreadsheetApp.flush(); // Force script to apply all pending changes 
  Utilities.sleep(1000); // Wait a moment for the tab to appear
  
  // Find the new tab (the one ID that wasn't there before)
  var sheetsAfter = masterSpreadsheet.getSheets();
  var newSheet = sheetsAfter.find(s => !sheetsBefore.includes(s.getSheetId()));

  // 6. RENAME THE TAB
  var finalTabName = "Form Responses";
  if (newSheet) {
    // If a tab with our desired name exists, delete it
    var existingSheet = masterSpreadsheet.getSheetByName(finalTabName);
    if (existingSheet) {
      masterSpreadsheet.deleteSheet(existingSheet);
    }
    
    newSheet.setName(finalTabName);

    masterSpreadsheet.setActiveSheet(newSheet); // Make the new sheet "Active" so we can move it    
    masterSpreadsheet.moveActiveSheet(3); // Move "Form Responses" sheet to index 3 (3rd from the left)

    var cleanedResponseSheet = masterSpreadsheet.getSheetByName("Responses Cleaned");
    cleanedResponseSheet.getRange("A24").setValue("=ARRAYFORMULA(LET(\n  swapped, HSTACK('" + finalTabName + "'!B:B, '" + finalTabName + "'!A:A, '" + finalTabName + "'!C:T),\n  IFERROR(REGEXREPLACE(swapped, " + '" \\(Away\\)| \\(Home\\)| \\(.*\\).*\\@.*", ""), swapped)\n))');
  }
}