function updateMasterSheet() {
  var masterSpreadsheet = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var standingsSpreadsheet = SpreadsheetApp.openById(STANDINGS_SHEET_ID);

  var standingsSheets = standingsSpreadsheet.getSheets();
  var lastWeekSheet = standingsSheets[standingsSheets.length-1];
  var thisWeekSheetName = WEEK_NAME;
  if (lastWeekSheet.getName() !== thisWeekSheetName) {
    thisWeekSheet = lastWeekSheet.copyTo(standingsSpreadsheet);
    thisWeekSheet.setName(thisWeekSheetName);
    
    var masterStandingsSheet = masterSpreadsheet.getSheetByName("Standings");
    var standingsColumns = 4;
    var standingsFirstRow = 3;
    if (lastWeekSheet.getRange(standingsFirstRow, 1).getFormula() !== "") {
      // var lastWeekStandings = masterStandingsSheet.getRange(standingsFirstRow, 1, masterStandingsSheet.getLastRow()-(standingsFirstRow-1), standingsColumns).getValues();
      // lastWeekSheet.getRange(standingsFirstRow, 1, lastWeekStandings.length, standingsColumns).setValues(lastWeekStandings);
      // Freeze last week's data
      var lastWeekData = lastWeekSheet.getDataRange();
      var backgroundColors = lastWeekData.getBackgrounds();
      var fontColorObjects = lastWeekData.getFontColorObjects()
      var fontWeights = lastWeekData.getFontWeights();

      lastWeekData.setValues(lastWeekData.getValues());

      lastWeekData.clearFormat();
      lastWeekSheet.clearConditionalFormatRules();
      lastWeekData.setBackgrounds(backgroundColors);
      lastWeekData.setFontColorObjects(fontColorObjects);
      lastWeekData.setFontWeights(fontWeights);
    }
    masterStandingsSheet.getRange(standingsFirstRow+1, standingsColumns, masterStandingsSheet.getLastRow()-standingsFirstRow, masterStandingsSheet.getLastColumn()-(standingsColumns-1)).clearContent();
  }

  var masterGameSheet = masterSpreadsheet.getSheetByName("Game Results");
  masterGameSheet.getRange("B3:7").clearContent();

  var masterApiSheet = masterSpreadsheet.getSheetByName("ESPN API");
  masterApiSheet.clearContents();

  var masterBettingSheet = masterSpreadsheet.getSheetByName("Betting Results");
  masterBettingSheet.getRange("B1").setValue(SCORE_MULTIPLIER);
}
