function getEspnSchedule() {
  // 1. Fetch data
  const options = {
    method: "get",
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(NFL_SCHEDULE_URL, options);
  // var response = UrlFetchApp.fetch("https://site.web.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=20260101-20260301", options);
  var responseCode = response.getResponseCode();
  var json = JSON.parse(response.getContentText());
  var events = json.events;
  // events = events.filter(e => e.name === "Australian Open");

  // 2. Set Headers
  var data = [['dateObj', 'Game Info', 'Favorites', 'Favorite Odds', 'Away Team', 'Home Team', 'Total Points']];

  // 3. Loop through games
  events.forEach(function(game) {
    var dateObj = new Date(game.date);

    // Create Column 1 -- e.g. "Sun @ 1:00 PM ET"
    var gameInfo = Utilities.formatDate(dateObj, "America/New_York", "EEE @ h:mm a z");

    // Extract Teams
    var comps = game.competitions[0];
    var homeTeam = comps.competitors.find(c => c.homeAway === 'home').team.name;
    var awayTeam = comps.competitors.find(c => c.homeAway === 'away').team.name;
    
    // Extract Favorite and Total Points Expected
    var favorite = awayTeam + " (Away)";
    var favoriteProb = "50.0%";
    var totalPointsExpected = "39.5";
    var awayOddsStr = "-100";
    var homeOddsStr = "-100";
    var awayOddsFound = false;
    var homeOddsFound = false;

    if ("odds" in comps) {
      var odds = comps.odds[0];

      if ("overUnder" in odds) {
        totalPointsExpected = odds.overUnder;
      }

      if ("moneyline" in odds) {
        var moneyline = odds.moneyline;

        if ("away" in moneyline) {
          var awayMoneyline = moneyline.away;
          if ("close" in awayMoneyline && "odds" in awayMoneyline.close) {
            awayOddsStr = awayMoneyline.close.odds;
            awayOddsFound = true;
          } else if ("open" in awayMoneyline && "odds" in awayMoneyline.open) {
            awayOddsStr = awayMoneyline.open.odds;
            awayOddsFound = true;
          }
        }
        if ("home" in moneyline) {
          var homeMoneyline = moneyline.home;
          if ("close" in homeMoneyline && "odds" in homeMoneyline.close) {
            homeOddsStr = homeMoneyline.close.odds;
            homeOddsFound = true;
          } else if ("open" in homeMoneyline && "odds" in homeMoneyline.open) {
            homeOddsStr = homeMoneyline.open.odds;
            homeOddsFound = true;
          }
        }

        if (homeOddsStr === "EVEN") {
          homeOddsStr = '-100';
        }
        if (awayOddsStr === "EVEN") {
          awayOddsStr = '-100';
        }
      }

      var awayOdds = parseInt(awayOddsStr);
      var homeOdds = parseInt(homeOddsStr);

      // Treat unparseable values the same as missing odds
      if (isNaN(awayOdds)) {
        awayOdds = -100;
        awayOddsFound = false;
      }
      if (isNaN(homeOdds)) {
        homeOdds = -100;
        homeOddsFound = false;
      }

      var awayProb = Math.max(-awayOdds, 100) / (Math.abs(awayOdds) + 100);
      var homeProb = Math.max(-homeOdds, 100) / (Math.abs(homeOdds) + 100);

      if (awayProb > homeProb) {
        favorite = awayTeam;
        favoriteProb = 100 * awayProb / (awayProb + homeProb);
      } else {
        favorite = homeTeam;
        favoriteProb = 100 * homeProb / (awayProb + homeProb);
      }

      favoriteProb = favoriteProb.toFixed(1) + "%";
      
      if ("provider" in odds && "name" in odds.provider) {
        favoriteProb += " (Source: " + odds.provider.name + ")";
        totalPointsExpected += " (Source: " + odds.provider.name + ")";
      }
    }

    // Warn if the moneyline couldn't be found and we fell back to defaults
    var gameLabel = awayTeam + " @ " + homeTeam;
    if (!awayOddsFound && !homeOddsFound) {
      console.warn("WARNING: No odds found for " + gameLabel + " (" + gameInfo + "). Defaulting to 50.0% probability.");
    } else if (!awayOddsFound) {
      console.warn("WARNING: Away odds missing for " + gameLabel + " (" + gameInfo + "). Defaulted away moneyline to -100, so the probability is not based on real odds.");
    } else if (!homeOddsFound) {
      console.warn("WARNING: Home odds missing for " + gameLabel + " (" + gameInfo + "). Defaulted home moneyline to -100, so the probability is not based on real odds.");
    }

    // Push row: Info, Away, Home
    data.push([dateObj, gameInfo, favorite, favoriteProb, awayTeam, homeTeam, totalPointsExpected]);
  });

  // 4. Remove Headers so we don't sort them
  var headers = data.shift(); 

  // 5. Apply the Multi-Level Sort
  data.sort((a, b) => {
    // Primary: Compare Dates (Time)
    var timeDiff = a[0] - b[0];
    if (timeDiff !== 0) {
      return timeDiff;
    }
    
    // Secondary: Compare Away Team (Alphabetical)
    // Use Column 1 (Away Team) to break the tie
    var teamA = a[4].toString();
    var teamB = b[4].toString();
    return teamA.localeCompare(teamB);
  });

  // 6. Re-Add Headers and remove dateObj column and Total Points column
  data.unshift(headers);
  var lastTotalPoints = data[data.length - 1][data[0].length - 1];
  data = data.map(row => row.slice(1, row.length - 1));

  var lastAwayTeam = data[data.length - 1][3];
  var lastHomeTeam = data[data.length - 1][4];
  data.push(["Tiebreaker: Total Points Scored in " + lastAwayTeam + "-" + lastHomeTeam + " Game", lastTotalPoints, "-", "-", "-"]);

  // 7. Transpose the data (Flip rows to columns)
  // Input:  [[Game 1, Away, Home], [Game 2, Away, Home]...]
  // Output: [[Game 1, Game 2...], [Away 1, Away 2...], [Home 1, Home 2...]]
  var transposedData = data[0].map((_, colIndex) => data.map(row => row[colIndex]));
  transposedData[0] = transposedData[0].map((gameInfo, index) => {
    if (index === 0 || index === transposedData[0].length - 1) {
      return gameInfo;
    } else {
      return "Game " + index + " (" + gameInfo + ")";
    }
  });
  
  return transposedData;
}