function seasonStandings() {
  var standingsSpreadsheet = SpreadsheetApp.openById(STANDINGS_SHEET_ID);

  // 1. CONFIGURATION: THE ALIAS MAP
  // Format: "Variation Name": "Official Master Name"
  var nameMap = {
    "Uncle Paul" : "Paul",
    "Gui Alves" : "Gui",
    "Daniel H" : "Daniel",
    "Gram" : "Barb",
  };

  // 2. SETUP STORAGE
  // { "Paul": { earned: 0, attempted: 0, weeksPlayed: 0 } }
  var playerData = {};
  var standingsSheets = standingsSpreadsheet.getSheets();
  var totalWeeks = 0;

  // 3. LOOP THROUGH ALL WEEKLY SHEETS
  standingsSheets.forEach(function(sheet) {
    var sheetName = sheet.getName();

    // Only look at sheets that have weekly standings
    if (!["Season Standings", "ESPN API"].includes(sheetName)) {

      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {

        // Data format: Col B = Name, Col C = Score, Col D = that player's max/optimal
        // score for the week (can differ per player if their double game hasn't
        // happened yet), starting row 4
        var data = sheet.getRange("B4:D" + lastRow).getValues();
        var weekHasData = false;

        data.forEach(function(row) {
          var rawName = row[0];
          var score = parseFloat(row[1]) || 0;
          var playerMax = parseFloat(row[2]) || 0;

          // A cell can be non-empty but still not a real player: a formula that
          // hasn't resolved yet returns an error string like "#N/A" or "#REF!",
          // and getValues() reports that string as the cell's value. Treat those
          // as blank rather than as a player named "#N/A".
          var isRealName =
            typeof rawName === "string" &&
            rawName.trim() !== "" &&
            rawName.trim().charAt(0) !== "#";

          if (isRealName) {
            weekHasData = true;

            // NORMALIZATION: Check the map. If not found, use the raw name.
            var cleanName = rawName.trim();
            var masterName = nameMap[cleanName] || cleanName;

            if (!playerData[masterName]) {
              playerData[masterName] = { earned: 0, attempted: 0, weeksPlayed: 0 };
            }

            playerData[masterName].earned += score;
            playerData[masterName].attempted += playerMax;
            playerData[masterName].weeksPlayed += 1;
          }
        });

        // Only count this as an official "week" if someone actually played
        if (weekHasData) {
          totalWeeks += 1;
        }
      }
    }
  });

  // Minimum weeks needed to be eligible: at least half the season, rounded up
  var minWeeksRequired = Math.ceil(totalWeeks / 2);

  // 4. BUILD OUTPUT ARRAY WITH PERCENTAGES + ELIGIBILITY
  var allPlayers = [];
  for (var name in playerData) {
    var pd = playerData[name];
    var pct = pd.attempted > 0 ? (pd.earned / pd.attempted) : 0;
    var eligible = pd.weeksPlayed >= minWeeksRequired;

    allPlayers.push({
      name: name,
      earned: pd.earned,
      attempted: pd.attempted,
      weeksPlayed: pd.weeksPlayed,
      pct: pct,
      eligible: eligible
    });
  }

  // Split into eligible / ineligible groups
  var eligiblePlayers = allPlayers.filter(function(p) { return p.eligible; });
  var ineligiblePlayers = allPlayers.filter(function(p) { return !p.eligible; });

  // Sort eligible players by percentage descending
  eligiblePlayers.sort(function(a, b) {
    return b.pct - a.pct;
  });

  // Sort ineligible players by percentage descending too (just for consistency)
  ineligiblePlayers.sort(function(a, b) {
    return b.pct - a.pct;
  });

  // 5. APPLY RANKS WITH TIE LOGIC (eligible players only)
  var finalOutput = [];
  var currentRank = 1;

  for (var i = 0; i < eligiblePlayers.length; i++) {
    var p = eligiblePlayers[i];

    if (i > 0) {
      var prevPct = eligiblePlayers[i - 1].pct;
      if (p.pct < prevPct) {
        currentRank = i + 1;
      }
      // if equal, currentRank stays the same (tie)
    }

    finalOutput.push([
      currentRank,
      p.name,
      (p.pct * 100).toFixed(3) + "%",
      p.earned.toFixed(3),
      p.attempted.toFixed(3),
      p.weeksPlayed
    ]);
  }

  // Ineligible players go at the bottom, marked in the Placement column
  ineligiblePlayers.forEach(function(p) {
    finalOutput.push([
      "Ineligible",
      p.name,
      (p.pct * 100).toFixed(3) + "%",
      p.earned.toFixed(3),
      p.attempted.toFixed(3),
      p.weeksPlayed
    ]);
  });

  // Add Header
  finalOutput.unshift(["Placement", "Name", "Point %", "Points Earned", "Points Possible", "Weeks Played"]);

  // 6. WRITE TO 'SEASON STANDINGS' SHEET
  var seasonStandingsSheet = standingsSpreadsheet.getSheetByName("Season Standings");

  if (!seasonStandingsSheet) {
    seasonStandingsSheet = standingsSpreadsheet.insertSheet("Season Standings");
  }

  seasonStandingsSheet.getRange(3, 1, seasonStandingsSheet.getLastRow()-2, seasonStandingsSheet.getLastColumn()).clearContent();
  var outputRange = seasonStandingsSheet.getRange(3, 1, finalOutput.length, finalOutput[0].length);
  outputRange.setValues(finalOutput);

  // 7. ALIGNMENT: Names (Col B) left-aligned, everything else right-aligned
  var numRows = finalOutput.length;
  var numCols = finalOutput[0].length;

  outputRange.setHorizontalAlignment("right"); // default everything to right

  // Column B is the 2nd column in the range (Name)
  seasonStandingsSheet.getRange(3, 2, numRows, 1).setHorizontalAlignment("left");

  // Weeks Played (last column) is always a whole number
  seasonStandingsSheet.getRange(3, numCols, numRows, 1).setNumberFormat("0");
}