function getLiveEspnData() {
  var activeGames = false;
  var nowDateObj = new Date();

  // 1. Fetch data
  var response = UrlFetchApp.fetch(NFL_SCHEDULE_URL);
  var json = JSON.parse(response.getContentText());
  var events = json.events;
  
  // 2. Set Headers
  var output = [['dateObj', 'Day & Time', 'Network(s)', 'Away Team', 'Home Team', 'Away Score', 'Home Score', 'Status', 'Game Winner', 'Game Loser', 'Total Points']];

  // 3. Loop through games
  events.forEach(function(game) {
    var dateObj = new Date(game.date);

    // Create Column 1 -- e.g. "Game 1 (Sun @ 1:00 PM EST/EDT)"
    var dayTime = Utilities.formatDate(dateObj, "America/New_York", "EEE @ h:mm a z");

    var competition = game.competitions[0];
    var status = game.status.type.state; // 'pre', 'in', or 'post'
    
    // Get Teams
    var homeTeam = competition.competitors.find(c => c.homeAway === 'home');
    var awayTeam = competition.competitors.find(c => c.homeAway === 'away');

    // Get Scores (Ensure numbers)
    var homeScore = parseInt(homeTeam.score) || 0;
    var awayScore = parseInt(awayTeam.score) || 0;
    var totalPoints = homeScore + awayScore;

    // Determine Winner/Loser (Only if game is over)
    var winner = "";
    var loser = "";
    
    if (status === 'post') {
      if (homeScore > awayScore) {
        winner = homeTeam.team.name;
        loser = awayTeam.team.name;
      } else if (awayScore > homeScore) {
        winner = awayTeam.team.name;
        loser = homeTeam.team.name;
      } else {
        winner = "Tie";
        loser = "Tie";
      }
    }

    // Determine Detailed Game Status
    var fullStatus = "";
    
    if (status === 'pre') {
      fullStatus = "Not Started";
    } else {
      fullStatus = game.status.type.detail;
      activeGames = true;
    }

    // Determine Network(s) Hosting the Game
    var networks = competition.broadcasts.flatMap(bc => bc.names).join("; ");

    // Push Row
    output.push([
      dateObj,
      dayTime,
      networks,
      awayTeam.team.name,
      homeTeam.team.name,
      awayScore,
      homeScore,
      fullStatus,
      winner,
      loser,
      totalPoints,
      // dateTime,
    ]);
  });

  var masterForm = FormApp.openById(MASTER_FORM_ID);
  if (activeGames) {
    // var nowString = Utilities.formatDate(nowDateObj, "America/New_York", "EEE @ h:mm a z");
    var firstGameTime = output[1][1];

    var masterSpreadsheetUrl = SpreadsheetApp.openById(MASTER_SHEET_ID).getUrl().replace("/edit", "");

    if (LOCK_FORM && masterForm.isAcceptingResponses()) {
      var closedFormMessage = "Sorry, the " + WEEK_NAME + " pool is locked from accepting new entries! The first game of the week has already started on " + firstGameTime + ".\n\nYou can view the live weekly spreadsheet here:\n" + masterSpreadsheetUrl + "\n\nOr experience the integrated site with all the live data at your fingertips here:\n" + "https://sites.google.com/view/pickemetrics/home"

      masterForm.setCustomClosedFormMessage(closedFormMessage);
      masterForm.setAcceptingResponses(false);
    } else if (!LOCK_FORM && !masterForm.isAcceptingResponses()) {
      masterForm.setAcceptingResponses(true);
    }
  }



  // 4. Remove Headers so we don't sort them
  var headers = output.shift(); 

  // 5. Apply the Multi-Level Sort
  output.sort((a, b) => {
    // Primary: Compare Dates (Time)
    var timeDiff = a[0] - b[0];
    if (timeDiff !== 0) {
      return timeDiff;
    }
    
    // Secondary: Compare Away Team (Alphabetical)
    // Use Column 3 (Away Team) to break the tie
    var teamA = a[3].toString();
    var teamB = b[3].toString();
    return teamA.localeCompare(teamB);
  });

  // 6. Re-Add Headers and remove dateObj column
  output.unshift(headers);
  output = output.map(row => row.slice(1));

  // 7. Write to Sheet
  var masterSpreadsheet = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var espnApiSheet = masterSpreadsheet.getSheetByName("ESPN API");
  espnApiSheet.getRange(3, 1, output.length, output[0].length).setValues(output);

  var nowString = Utilities.formatDate(nowDateObj, "America/New_York", "MM/dd/yyyy h:mm:ss a z");
  espnApiSheet.getRange("B1").setValue(nowString);
}
