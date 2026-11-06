function pendingScoreAndMaxRank() {
  var masterSpreadsheet = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var responsesSheet = masterSpreadsheet.getSheetByName("Responses Cleaned");
  var resultsSheet = masterSpreadsheet.getSheetByName("Game Results");
  var standingsSheet = masterSpreadsheet.getSheetByName("Standings");
  var espnApiSheet = masterSpreadsheet.getSheetByName("ESPN API");

  // 1. GET DATA
  var headerRow = 24;

  var headerVals = responsesSheet
    .getRange("C" + headerRow + ":" + headerRow)
    .getValues()
    .flat()
    .filter(header => header !== "");

  var numGames = headerVals.length - 2;

  // Get all player picks (Row 25 down)
  var dataRow = headerRow + 1;

  var playerNames = responsesSheet
    .getRange("A" + dataRow + ":A")
    .getValues()
    .flat()
    .filter(name => name !== "");

  var numPlayers = playerNames.length;

  if (numPlayers === 0) {
    return;
  }

  var playerPicks = responsesSheet
    .getRange(dataRow, 3, numPlayers, numGames)
    .getValues();

  var playerTiebreakers = responsesSheet
    .getRange(dataRow, numGames + 3, numPlayers, 1)
    .getValues()
    .flat();

  var playerDoubleGames = responsesSheet
    .getRange(dataRow, numGames + 4, numPlayers, 1)
    .getValues()
    .flat()
    .map(function(game) {
      if (!game) return 0;

      var match = String(game).match(/\d+/);
      return match ? Number(match[0]) : 0;
    });

  // Get live player standings
  var playerStandings = standingsSheet
    .getRange(4, 2, numPlayers, 2)
    .getValues();

  // Each player's current, officially recorded score, maintained in the
  // Standings sheet (Column C) rather than recomputed here - keeps this
  // script in sync with whatever process maintains that column, instead
  // of duplicating the "did this pick match the completed game" logic.
  var currentScoresByName = {};
  playerStandings.forEach(function(row) {
    currentScoresByName[row[0]] = Number(row[1]) || 0;
  });

  // Get actual results so far (row 8)
  var actualResults = resultsSheet
    .getRange(8, 2, 1, numGames)
    .getValues()
    .flat();

  // Get live game data from ESPN API
  var liveGameData = espnApiSheet
    .getRange(4, 3, numGames, 8)
    .getValues();

  // A late response (submitted after a game already started) isn't counted
  // for or against a player's score for that one game - see isLate below.
  var playerTimestamps = responsesSheet
    .getRange(dataRow, 2, numPlayers, 1)
    .getValues()
    .flat();

  var gameTimeText = espnApiSheet
    .getRange(4, 1, numGames, 1)
    .getValues()
    .flat();

  var isLate = computeLateMatrix_(playerTimestamps, gameTimeText);

  // Determine the currently projected result of every game.
  // Official result > live result > blank if not started.
  var pendingResults = actualResults.map(function(result, gameIndex) {
    if (result !== "") {
      return result;
    }

    var gameData = liveGameData[gameIndex];
    var gameStatus = gameData[4];

    if (gameStatus !== "Not Started") {
      var awayTeam = gameData[0];
      var homeTeam = gameData[1];
      var awayScore = Number(gameData[2]);
      var homeScore = Number(gameData[3]);

      if (awayScore < homeScore) {
        return homeTeam;
      } else if (awayScore > homeScore) {
        return awayTeam;
      } else {
        return "Tie";
      }
    }

    return "";
  });

  var tiebreakerPending = resultsSheet
    .getRange(8, numGames + 2)
    .getValue();

  var perfectScores = {};
  var pendingScores = {};
  var pendingPerfectScores = {};

  // Best possible rank plus the teams each player needs to win to reach it.
  var bestPossible = calculateBestPossibleRanks_(
    playerNames,
    playerPicks,
    playerDoubleGames,
    playerTiebreakers,
    tiebreakerPending,
    actualResults,
    liveGameData,
    currentScoresByName
  );
  var maxRanks = bestPossible.ranks;
  var maxRankTeams = bestPossible.teams;

  // 2. LOOP THROUGH EVERY PLAYER (The "Hero" of their own simulation)
  for (var i = 0; i < playerPicks.length; i++) {
    var heroPicks = playerPicks[i];
    var heroTiebreaker = playerTiebreakers[i];
    var heroDouble = playerDoubleGames[i];

    var perfectScore = 0;
    var pendingPerfectScore = 0;

    // ------------------------------------------------------------
    // A. CURRENT / PROJECTED SCORE
    //    Starts from the player's current score already recorded in the
    //    Standings sheet (Column C), same source as baseScores above, then
    //    adds only the live-game points that aren't officially final yet
    //    and so aren't reflected there. Completed games are skipped
    //    entirely rather than being re-scored from picks and results.
    // ------------------------------------------------------------
    var pendingScore = Number(currentScoresByName[playerNames[i]]) || 0;

    for (var j = 0; j < heroPicks.length; j++) {
      if (actualResults[j] !== "") {
        // Already included in the current score above.
        continue;
      }

      var score = 0;

      if (pendingResults[j] === heroPicks[j]) {
        score = 1;
      } else if (pendingResults[j] === "Tie") {
        score = 0.5;
      }

      // Double points for a double-game pick (Double game numbering is 1-indexed but j is 0-indexed)
      if (heroDouble === j + 1) {
        score *= 2;
      }

      pendingScore += score * SCORE_MULTIPLIER;
    }

    // Once the tiebreaker game is LIVE - started, but not yet officially
    // final - estimate the penalty here using the current in-game total,
    // so Pending Score reflects it as soon as the game starts, same as
    // before. This stops firing once the game is actually final: at that
    // point Column C (currentScoresByName) takes over and includes the
    // official deduction itself, so this step deliberately backs off
    // rather than subtracting it a second time on top of that.
    var tiebreakerGameIsLive =
      actualResults[actualResults.length - 1] === "" &&
      pendingResults[pendingResults.length - 1] !== "";

    if (tiebreakerGameIsLive) {
      pendingScore -= Math.abs(tiebreakerPending - heroTiebreaker) / 100;
    }

    pendingScores[playerNames[i]] = pendingScore;

    // ------------------------------------------------------------
    // B. PERFECT SCORE
    //    Assume the player got EVERY COMPLETED GAME correct.
    //    Uncompleted games contribute nothing, and neither do completed
    //    games the player's pick was too late to count for or against.
    // ------------------------------------------------------------
    for (var j = 0; j < heroPicks.length; j++) {
      if (actualResults[j] !== "" && !isLate[i][j]) {
        var gameScore = 1;

        // Double points if the completed game is their double game
        if (heroDouble === j + 1) {
          gameScore *= 2;
        }

        perfectScore += gameScore;
      }
    }

    perfectScore *= SCORE_MULTIPLIER;

    perfectScores[playerNames[i]] = perfectScore;

    // ------------------------------------------------------------
    // C. PENDING PERFECT SCORE
    //    Assume the player gets maximum credit for every game that
    //    is completed or currently live.
    //
    //    Not-started games contribute nothing, and neither do games the
    //    player's pick was too late to count for or against.
    // ------------------------------------------------------------
    for (var j = 0; j < heroPicks.length; j++) {
      if (pendingResults[j] !== "" && !isLate[i][j]) {
        var pendingPerfectGameScore = 1;

        // Double points for the player's double game
        if (heroDouble === j + 1) {
          pendingPerfectGameScore *= 2;
        }

        pendingPerfectScore += pendingPerfectGameScore;
      }
    }

    pendingPerfectScore *= SCORE_MULTIPLIER;

    pendingPerfectScores[playerNames[i]] = pendingPerfectScore;

    // ------------------------------------------------------------
    // D-F. BEST POSSIBLE PLACEMENT
    //     Calculated once for all players before this loop. The
    //     shared evaluator avoids repeating the same scenarios for
    //     every hero.
    // ------------------------------------------------------------
  }

  // 3. SORT RESULTS TO MATCH STANDINGS SHEET ORDER
  var perfectScoresSorted = playerStandings.map(function(player) {
    return [perfectScores[player[0]]];
  });

  var pendingScoresSorted = playerStandings.map(function(player) {
    return [pendingScores[player[0]]];
  });

  var pendingPerfectScoresSorted = playerStandings.map(function(player) {
    return [pendingPerfectScores[player[0]]];
  });

  var maxRanksSorted = playerStandings.map(function(player) {
    return [maxRanks[player[0]]];
  });

  var maxRankTeamsSorted = playerStandings.map(function(player) {
    return [maxRankTeams[player[0]]];
  });

  // 4. WRITE RESULTS
  // D = Perfect Score
  // E = Pending Score
  // F = Pending Perfect Score
  // G = Max Rank
  // H = Teams needed to win for Max Rank

  standingsSheet
    .getRange(4, 4, perfectScoresSorted.length, 1)
    .setValues(perfectScoresSorted);

  standingsSheet
    .getRange(4, 5, pendingScoresSorted.length, 1)
    .setValues(pendingScoresSorted);

  standingsSheet
    .getRange(4, 6, pendingPerfectScoresSorted.length, 1)
    .setValues(pendingPerfectScoresSorted);

  standingsSheet
    .getRange(4, 7, maxRanksSorted.length, 1)
    .setValues(maxRanksSorted);

  standingsSheet
    .getRange(4, 8, maxRankTeamsSorted.length, 1)
    .setValues(maxRankTeamsSorted);
}

/**
 * Calculates every player's best possible rank in one shared search, and
 * remembers every scenario in which each player reaches that rank.
 * Scores are updated incrementally using Gray-code scenario changes,
 * avoiding a full player-by-game score calculation for each scenario.
 *
 * @param {Object} currentScoresByName Each player's current score, keyed
 *   by name, as already recorded in the Standings sheet (Column C). Used
 *   as the starting point instead of recomputing points for completed
 *   games from playerPicks and actualResults.
 * @return {{ranks: Object, teams: Object}} Both keyed by player name.
 *   ranks: best possible rank.
 *   teams: text describing which teams must win to reach that rank.
 */
function calculateBestPossibleRanks_(
  playerNames,
  playerPicks,
  playerDoubleGames,
  playerTiebreakers,
  tiebreakerPending,
  actualResults,
  liveGameData,
  currentScoresByName
) {
  var numPlayers = playerPicks.length;
  var unresolvedGames = [];
  var outcomesByGame = {};

  // Completed games' contribution to each player's score comes straight
  // from the Standings sheet (via currentScoresByName) rather than being
  // re-derived here by comparing picks to results - this keeps a single
  // source of truth for "what has this player actually scored so far."
  var baseScores = playerNames.map(function(name) {
    return Number(currentScoresByName[name]) || 0;
  });

  for (var gameIndex = 0; gameIndex < actualResults.length; gameIndex++) {
    if (actualResults[gameIndex] !== "") {
      // Already reflected in baseScores above - nothing further to add.
      continue;
    }

    var gameData = liveGameData[gameIndex] || [];
    var outcomes = [];

    if (gameData[0] !== "") {
      outcomes.push(gameData[0]);
    }
    if (gameData[1] !== "" && outcomes.indexOf(gameData[1]) === -1) {
      outcomes.push(gameData[1]);
    }

    // Keep the search robust when ESPN has not populated team names yet.
    if (outcomes.length === 0) {
      for (var pickIndex = 0; pickIndex < numPlayers; pickIndex++) {
        var pick = playerPicks[pickIndex][gameIndex];
        if (pick !== "" && outcomes.indexOf(pick) === -1) {
          outcomes.push(pick);
        }
      }
    }

    if (outcomes.length === 0) {
      outcomes.push("");
    }

    // A one-outcome game does not need a scenario bit.
    if (outcomes.length === 1) {
      for (var singlePlayerIndex = 0;
        singlePlayerIndex < numPlayers;
        singlePlayerIndex++) {
        if (playerPicks[singlePlayerIndex][gameIndex] === outcomes[0]) {
          baseScores[singlePlayerIndex] += getGameScore_(
            playerDoubleGames[singlePlayerIndex],
            gameIndex
          ) * SCORE_MULTIPLIER;
        }
      }
    } else {
      unresolvedGames.push(gameIndex);
      outcomesByGame[gameIndex] = outcomes;
    }
  }

  // Match the current-score calculation once the final game has a result.
  // This is the same condition used by pendingScoreAndMaxRank().
  var allGamesFinal =
    actualResults.length > 0 &&
    actualResults[actualResults.length - 1] !== "";

  if (allGamesFinal) {
    for (var tiebreakerPlayerIndex = 0;
      tiebreakerPlayerIndex < numPlayers;
      tiebreakerPlayerIndex++) {
      baseScores[tiebreakerPlayerIndex] -=
        Math.abs(
          tiebreakerPending -
          playerTiebreakers[tiebreakerPlayerIndex]
        ) / 100;
    }
  }

  // bestRanks: best rank found so far, keyed by player name.
  // bestScenarios: scenarios (as bitmasks) that produce that rank outright.
  // bestTiedScenarios: scenarios that produce that rank only by tying
  //   another player on points, so the tiebreaker would decide it.
  //   Bit N of a mask is the outcome of unresolvedGames[N]:
  //   0 = outcomes[0] (away team), 1 = outcomes[1] (home team).
  var bestRanks = {};
  var bestScenarios = {};
  var bestTiedScenarios = {};
  for (var playerIndex = 0; playerIndex < numPlayers; playerIndex++) {
    bestRanks[playerNames[playerIndex]] = numPlayers;
    bestScenarios[playerNames[playerIndex]] = [];
    bestTiedScenarios[playerNames[playerIndex]] = [];
  }

  var scenarioContributions = unresolvedGames.map(function(gameIndex) {
    var outcomes = outcomesByGame[gameIndex];
    return playerPicks.map(function(picks, playerIndex) {
      var gameScore = getGameScore_(
        playerDoubleGames[playerIndex],
        gameIndex
      ) * SCORE_MULTIPLIER;
      return [
        picks[gameIndex] === outcomes[0] ? gameScore : 0,
        picks[gameIndex] === outcomes[1] ? gameScore : 0,
      ];
    });
  });

  var scores = baseScores.slice();

  // Scenario 0 has every unresolved game at outcome index 0,
  // so start the running totals from that state.
  for (var g = 0; g < scenarioContributions.length; g++) {
    for (var p = 0; p < numPlayers; p++) {
      scores[p] += scenarioContributions[g][p][0];
    }
  }

  var previousGrayCode = 0;
  var scenarioCount = Math.pow(2, unresolvedGames.length);

  for (var scenario = 0; scenario < scenarioCount; scenario++) {
    var grayCode = scenario ^ (scenario >> 1);

    if (scenario > 0) {
      var changedBit = Math.round(Math.log2(grayCode ^ previousGrayCode));
      var contributionByPlayer = scenarioContributions[changedBit];
      var oldOutcomeIndex = (previousGrayCode >> changedBit) & 1;
      var newOutcomeIndex = (grayCode >> changedBit) & 1;

      for (var playerIndex = 0; playerIndex < numPlayers; playerIndex++) {
        scores[playerIndex] +=
          contributionByPlayer[playerIndex][newOutcomeIndex] -
          contributionByPlayer[playerIndex][oldOutcomeIndex];
      }

      previousGrayCode = grayCode;
    }

    var rankedPlayers = scores.map(function(score, playerIndex) {
      return { score: score, playerIndex: playerIndex };
    });

    rankedPlayers.sort(function(left, right) {
      return right.score - left.score;
    });

    var rank = 1;
    for (var sortedIndex = 0; sortedIndex < rankedPlayers.length; sortedIndex++) {
      if (
        sortedIndex > 0 &&
        rankedPlayers[sortedIndex].score < rankedPlayers[sortedIndex - 1].score
      ) {
        rank = sortedIndex + 1;
      }

      var playerIndex = rankedPlayers[sortedIndex].playerIndex;
      var playerName = playerNames[playerIndex];

      // Tied if the player shares a score with the neighbor above or below.
      // Uses the same "strictly less" comparison as the rank logic above.
      var currentScore = rankedPlayers[sortedIndex].score;
      var tiedWithAbove =
        sortedIndex > 0 &&
        !(currentScore < rankedPlayers[sortedIndex - 1].score);
      var tiedWithBelow =
        sortedIndex < rankedPlayers.length - 1 &&
        !(rankedPlayers[sortedIndex + 1].score < currentScore);
      var isTied = tiedWithAbove || tiedWithBelow;

      if (rank < bestRanks[playerName]) {
        // New best rank: forget the older, worse scenarios.
        bestRanks[playerName] = rank;
        bestScenarios[playerName] = isTied ? [] : [grayCode];
        bestTiedScenarios[playerName] = isTied ? [grayCode] : [];
      } else if (rank === bestRanks[playerName]) {
        if (isTied) {
          bestTiedScenarios[playerName].push(grayCode);
        } else {
          bestScenarios[playerName].push(grayCode);
        }
      }
    }

    // There is intentionally no early exit here. Finding every scenario
    // that achieves each player's best rank requires visiting all of them.
  }

  // A tied-for-first scenario is still a real path to the best rank - it
  // just needs the season tiebreaker (closest guess on the Eagles-Bears
  // total) to land in the player's favor. Both outright and tie-dependent
  // scenarios count as workable outcomes, so both are combined here; the
  // qualifier below then says how much of that total actually depends on
  // the tiebreaker.
    var teamsNeeded = {};
  for (var nameIndex = 0; nameIndex < numPlayers; nameIndex++) {
    var name = playerNames[nameIndex];
    teamsNeeded[name] = formatBestRankPaths_(
      bestScenarios[name],
      bestTiedScenarios[name],
      unresolvedGames,
      outcomesByGame
    );
  }

  return { ranks: bestRanks, teams: teamsNeeded };
}

/**
 * Turns the list of scenarios that give a player their best rank into
 * a short piece of text for the Standings sheet.
 *
 * Output styles, in order of preference:
 *   "Rams, Bears"                     - these teams must win; other games don't matter
 *   "Any result"                      - best rank is reached no matter what
 *   "Any except Rams + Bears"         - fails only if this exact combination wins,
 *                                       however many individual scenarios that covers
 *   "Falcons + 40 workable combinations for the rest"
 *                                      - some team(s) are always required, but the
 *                                       remaining games don't reduce to a clean rule
 *   "61.00% of remaining outcomes work"
 *                                      - no team's result is required at all
 *   "Final"                           - no games left to decide
 *
 * The last two styles intentionally summarize rather than enumerate: with many
 * unresolved games (e.g. the start of a week), the winning scenarios are often
 * numerous and don't collapse into one tidy rule, so listing them individually
 * would produce an unusably long string. A short, honest summary is more useful
 * than a wall of "A + B + C... OR D + E + F..." text.
 *
 * @param {Array<number>} masks Scenario bitmasks that reach the best rank.
 * @param {Array<number>} unresolvedGames Game indexes, one per bit.
 * @param {Object} outcomesByGame Team outcomes keyed by game index.
 * @return {string}
 */
function formatTeamsNeeded_(masks, unresolvedGames, outcomesByGame) {
  var numOpenGames = unresolvedGames.length;
  if (numOpenGames === 0) {
    return "Final";
  }

  var totalScenarios = Math.pow(2, numOpenGames);
  var allBits = totalScenarios - 1;

  if (masks.length === totalScenarios) {
    return "Any result";
  }

  // Names the winning team for each game whose bit is set in includeBits.
  function teamsFor(mask, includeBits) {
    var teams = [];
    for (var bit = 0; bit < numOpenGames; bit++) {
      if ((includeBits >> bit) & 1) {
        var outcomes = outcomesByGame[unresolvedGames[bit]];
        teams.push(outcomes[(mask >> bit) & 1]);
      }
    }
    return teams;
  }

  // Given a set of scenario masks, finds which bits stay the same across
  // every one of them (required results) versus which vary (free games),
  // then checks whether the set is EXACTLY every combination of the free
  // bits with the required bits held fixed. When it is, the required bits
  // alone describe the whole set with nothing lost; when it isn't, the set
  // has some other shape (e.g. correlations between games) that a simple
  // required-teams rule can't capture, and isExact comes back false.
  function collapseToRequiredBits(scenarioMasks) {
    if (scenarioMasks.length === 0) {
      return null;
    }

    var andMask = allBits;
    var orMask = 0;
    scenarioMasks.forEach(function(mask) {
      andMask &= mask;
      orMask |= mask;
    });
    var freeBits = andMask ^ orMask;

    var freeCount = 0;
    for (var bit = 0; bit < numOpenGames; bit++) {
      if ((freeBits >> bit) & 1) {
        freeCount++;
      }
    }

    var requiredBits = allBits & ~freeBits;
    return {
      andMask: andMask,
      requiredBits: requiredBits,
      isExact: scenarioMasks.length === Math.pow(2, freeCount),
    };
  }

  // Case 1: the winning scenarios are exactly "these teams win, everything
  // else can go either way." The required teams alone describe them.
  var winning = collapseToRequiredBits(masks);
  if (winning.isExact) {
    return winning.requiredBits === 0
      ? "Any result"
      : teamsFor(winning.andMask, winning.requiredBits).join(", ");
  }

  // Case 2: the LOSING scenarios collapse that way instead - the best rank
  // is missed only when a specific set of teams all win, and every other
  // game is irrelevant. However many individual scenarios that covers,
  // phrase it as a single exception rather than enumerating them.
  var present = {};
  masks.forEach(function(mask) {
    present[mask] = true;
  });
  var missing = [];
  for (var scenarioMask = 0; scenarioMask < totalScenarios; scenarioMask++) {
    if (!present[scenarioMask]) {
      missing.push(scenarioMask);
    }
  }

  var losing = collapseToRequiredBits(missing);
  if (losing && losing.isExact) {
    var failTeams = teamsFor(losing.andMask, losing.requiredBits);
    return "Any except " + failTeams.join(" + ") + " all winning";
  }

  // Case 3: neither side reduces to a clean rule.
  // If some teams are required in every winning scenario, report them plus
  // the share of the REMAINING outcomes (the games that aren't fixed by
  // those required results) that work.
  if (winning.requiredBits !== 0) {
    var requiredTeams = teamsFor(winning.andMask, winning.requiredBits);

    // Count how many games are locked in by the required teams.
    var requiredCount = 0;
    for (var bit = 0; bit < numOpenGames; bit++) {
      if ((winning.requiredBits >> bit) & 1) {
        requiredCount++;
      }
    }

    // Scenarios that have the required teams winning = 2^(open - required).
    var remainingScenarios = Math.pow(2, numOpenGames - requiredCount);

    return (
      requiredTeams.join(", ") +
      " + " + formatPercent_(masks.length, remainingScenarios) +
      " of remaining outcomes work"
    );
  }

  return (
    formatPercent_(masks.length, totalScenarios) +
    " of remaining outcomes work"
  );
}

/**
 * Determines, for every player and every game, whether that player's
 * response came in after the game had already started - mirroring the
 * same lateness check used in the Responses Cleaned sheet formula, so a
 * late pick is excluded here too, rather than counted for or against them.
 *
 * The week's anchor Thursday is the earliest response from anyone in the
 * pool, since that response necessarily predates every game that week -
 * there's no ambiguity about which week it belongs to, the way there would
 * be anchoring off each player's own (possibly later) response instead.
 *
 * All day/time comparisons happen in US Eastern time (matching the
 * "EDT"/"EST" suffix on the ESPN game times), independent of whatever
 * timezone this script or the spreadsheet happens to be set to.
 *
 * @param {Array<Date>} playerTimestamps Each player's response timestamp.
 * @param {Array<string>} gameTimeText Each game's ESPN API "Day & Time"
 *   text, e.g. "Thu @ 8:15 PM EDT".
 * @return {Array<Array<boolean>>} isLate[playerIndex][gameIndex].
 */
function computeLateMatrix_(playerTimestamps, gameTimeText) {
  var TIMEZONE = "America/New_York";
  var DAY_ABBREVIATIONS = "ThuFriSatSunMon"; // 3 chars each: Thu=0 ... Mon=4

  // Midnight (Eastern) of a date, expressed as a UTC millisecond value.
  // Both sides of every comparison below go through this same conversion,
  // so the actual UTC offset cancels out - only the calendar-day
  // difference between two dates, and each date's Eastern time-of-day,
  // end up mattering.
  function easternCalendarDayMs(date) {
    var dateStr = Utilities.formatDate(date, TIMEZONE, "yyyy-MM-dd");
    var parts = dateStr.split("-").map(Number);
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }

  function easternTimeFraction(date) {
    var timeStr = Utilities.formatDate(date, TIMEZONE, "HH:mm");
    var parts = timeStr.split(":").map(Number);
    return (parts[0] * 60 + parts[1]) / (24 * 60);
  }

  // Anchor: the Thursday on or after the earliest response.
  var earliestResponseMs = Math.min.apply(
    null,
    playerTimestamps.map(function(ts) {
      return ts.getTime();
    })
  );
  var earliestResponseDate = new Date(earliestResponseMs);

  // ISO weekday in Eastern time: Mon=1 ... Sun=7. Locale-independent,
  // unlike a weekday-name lookup, which can silently fail to match if the
  // spreadsheet or script's locale isn't English.
  var isoWeekday = Number(
    Utilities.formatDate(earliestResponseDate, TIMEZONE, "u")
  );
  var daysUntilThursday = (4 - isoWeekday + 7) % 7; // Thursday = 4
  var weekThursdayMs =
    easternCalendarDayMs(earliestResponseDate) +
    daysUntilThursday * 24 * 60 * 60 * 1000;

  // Each game's offset (in days, as a decimal) from that Thursday.
  var gameOffsets = gameTimeText.map(function(text) {
    var dayAbbrev = String(text).substring(0, 3);
    var dayOffset = DAY_ABBREVIATIONS.indexOf(dayAbbrev) / 3;

    var timeMatch = String(text).match(/(\d{1,2}):(\d{2}) (AM|PM)/);
    var hour = (Number(timeMatch[1]) % 12) + (timeMatch[3] === "PM" ? 12 : 0);
    var minute = Number(timeMatch[2]);
    var timeFraction = (hour * 60 + minute) / (24 * 60);

    return dayOffset + timeFraction;
  });

  // Each player's own offset (in days) from that same Thursday.
  var responseOffsets = playerTimestamps.map(function(ts) {
    var daysSinceThursday =
      (easternCalendarDayMs(ts) - weekThursdayMs) / (24 * 60 * 60 * 1000);
    return daysSinceThursday + easternTimeFraction(ts);
  });

  return responseOffsets.map(function(responseOffset) {
    return gameOffsets.map(function(gameOffset) {
      return gameOffset <= responseOffset;
    });
  });
}

/**
 * Describes the paths to a player's best rank, separating scenarios that
 * get it outright from those that only get it by tying (so the tiebreaker
 * would have to go their way).
 *
 * - Only outright paths: same text as before.
 * - Only tiebreak paths: same text as before + " (needs tiebreak)".
 * - Both: required teams (if any) + percent of remaining outcomes that work
 *   outright, and percent that work if the tiebreak goes their way. The
 *   second percentage includes the first, so it is always >= the first.
 *
 * Both percentages use the same denominator: the outcomes still open once
 * the always-required teams are fixed.
 *
 * @param {Array<number>} outrightMasks Scenarios that reach the best rank outright.
 * @param {Array<number>} tiedMasks Scenarios that reach it only via a points tie.
 * @param {Array<number>} unresolvedGames Game indexes, one per bit.
 * @param {Object} outcomesByGame Team outcomes keyed by game index.
 * @return {string}
 */
function formatBestRankPaths_(
  outrightMasks,
  tiedMasks,
  unresolvedGames,
  outcomesByGame
) {
  var numOpenGames = unresolvedGames.length;
  if (numOpenGames === 0) {
    return "Final";
  }

  if (tiedMasks.length === 0) {
    return formatTeamsNeeded_(outrightMasks, unresolvedGames, outcomesByGame);
  }

  if (outrightMasks.length === 0) {
    return (
      formatTeamsNeeded_(tiedMasks, unresolvedGames, outcomesByGame) +
      " (needs tiebreak)"
    );
  }

  // Both kinds exist. Find the teams required in EVERY workable scenario
  // (outright or tied), so both percentages share one denominator.
  var combined = outrightMasks.concat(tiedMasks);
  var allBits = Math.pow(2, numOpenGames) - 1;
  var andMask = allBits;
  var orMask = 0;
  combined.forEach(function(mask) {
    andMask &= mask;
    orMask |= mask;
  });

  var requiredBits = allBits & ~(andMask ^ orMask);
  var requiredTeams = [];
  var requiredCount = 0;
  for (var bit = 0; bit < numOpenGames; bit++) {
    if ((requiredBits >> bit) & 1) {
      var outcomes = outcomesByGame[unresolvedGames[bit]];
      requiredTeams.push(outcomes[(andMask >> bit) & 1]);
      requiredCount++;
    }
  }

    var denominator = Math.pow(2, numOpenGames - requiredCount);

  var prefix = requiredTeams.length > 0
    ? requiredTeams.join(", ") + " + "
    : "";

  return (
    prefix +
    formatPercent_(outrightMasks.length, denominator) + " outright, " +
    formatPercent_(combined.length, denominator) + " with tiebreak"
  );
}

/**
 * Formats a fraction as a percent with at most one decimal place,
 * dropping the decimal when it would be zero (20, 7.8, 33.3).
 * A nonzero share that would round down to 0 shows as "<0.1%" instead,
 * so a possible path never looks like an impossible one.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @return {string} e.g. "20%", "7.8%", or "<0.1%"
 */
function formatPercent_(numerator, denominator) {
  var rounded = Math.round((numerator / denominator) * 1000) / 10;

  if (numerator > 0 && rounded === 0) {
    return "<0.1%";
  }

  return rounded + "%";
}

/**
 * Returns the score contribution for one game.
 *
 * @param {number} doubleGame The player's 1-indexed double-game number.
 * @param {number} gameIndex Zero-based game index.
 * @return {number} One or two points.
 */
function getGameScore_(doubleGame, gameIndex) {
  return doubleGame === gameIndex + 1 ? 2 : 1;
}