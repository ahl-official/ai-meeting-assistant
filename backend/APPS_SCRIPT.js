function doPost(e) {
  var response = { success: false };
  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    
    if (action === "register") response = registerUser(params);
    else if (action === "login") response = loginUser(params);
    else if (action === "createMeeting") response = createMeeting(params);
    else if (action === "updateMeeting") response = updateMeeting(params);
    else if (action === "deleteMeeting") response = deleteMeeting(params);
    else response.error = "Unknown POST action";
  } catch (error) {
    response.error = error.toString();
  }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var response = { success: false };
  try {
    var action = e.parameter.action;
    if (action === "getMeeting") response = getMeeting(e.parameter.id);
    else if (action === "getUserMeetings") response = getUserMeetings(e.parameter.userId);
    else response.error = "Unknown GET action";
  } catch (error) {
    response.error = error.toString();
  }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

/* --- HELPER FUNCTIONS --- */
function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function getHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

/* --- USERS --- */
function registerUser(params) {
  var sheet = getSheet("Users");
  var headers = getHeaders(sheet);
  
  // Check if user already exists
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { // Skip headers
    if (String(data[i][0]).toLowerCase() === String(params.userId).toLowerCase()) {
      return { success: false, error: "User already exists" };
    }
  }
  
  sheet.appendRow([
    params.userId,
    params.name || "Default Name",
    params.department || "Default Dept",
    new Date().toISOString()
  ]);
  
  return { success: true, user: { userId: params.userId, name: params.name, department: params.department } };
}

function loginUser(params) {
  var sheet = getSheet("Users");
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(params.userId).toLowerCase()) {
      return { 
        success: true, 
        user: { userId: data[i][0], name: data[i][1], department: data[i][2] } 
      };
    }
  }
  return { success: false, error: "User not found. Please register." };
}

/* --- MEETINGS --- */
function createMeeting(params) {
  var sheet = getSheet("Meetings");
  var meetingId = params.meetingId || Utilities.getUuid(); 
  // Headers: Meeting ID | User ID | Title | Status | Progress | Summary | Action Items | Transcript | Created At
  sheet.appendRow([
    meetingId,
    params.userId,
    params.title || "Untitled Meeting",
    "processing",
    0,
    "", // summary
    "[]", // action items JSON array
    "", // transcript
    new Date().toISOString()
  ]);
  return { success: true, meetingId: meetingId };
}

function updateMeeting(params) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // Wait up to 10 seconds for other workers to finish writing
  
  try {
    var sheet = getSheet("Meetings");
    var data = sheet.getDataRange().getValues();
    
    // Find the row with the meetingId
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === params.meetingId) {
        var rowNum = i + 1;
        
        // Update specific columns if they exist in params
        if (params.title !== undefined) sheet.getRange(rowNum, 3).setValue(params.title);
        if (params.status !== undefined) sheet.getRange(rowNum, 4).setValue(params.status);
        if (params.progress !== undefined) sheet.getRange(rowNum, 5).setValue(params.progress);
        if (params.summary !== undefined) sheet.getRange(rowNum, 6).setValue(params.summary);
        if (params.action_items !== undefined) sheet.getRange(rowNum, 7).setValue(JSON.stringify(params.action_items));
        if (params.transcript !== undefined) sheet.getRange(rowNum, 8).setValue(params.transcript);
        
        return { success: true };
      }
    }
    return { success: false, error: "Meeting not found" };
  } finally {
    lock.releaseLock();
  }
}

function getMeeting(meetingId) {
  var sheet = getSheet("Meetings");
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === meetingId) {
      if (data[i][3] === "deleted") return { success: false, error: "Meeting deleted" };
      
      return {
        success: true,
        meeting: {
          id: data[i][0],
          user_id: data[i][1],
          title: data[i][2],
          status: data[i][3],
          progress: data[i][4],
          summary: data[i][5],
          action_items: (function() {
            try { return data[i][6] ? JSON.parse(data[i][6]) : []; }
            catch(e) { return []; }
          })(),
          transcript: data[i][7],
          created_at: data[i][8]
        }
      };
    }
  }
  return { success: false, error: "Meeting not found" };
}

function getUserMeetings(userId) {
  var sheet = getSheet("Meetings");
  var data = sheet.getDataRange().getValues();
  var meetings = [];
  
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === String(userId).toLowerCase()) {
      if (data[i][3] !== "deleted") { // Skip deleted meetings
        meetings.push({
          id: data[i][0],
          title: data[i][2],
          status: data[i][3],
          summary: data[i][5],
          action_items: (function() {
            try { return data[i][6] ? JSON.parse(data[i][6]) : []; }
            catch(e) { return []; }
          })(),
          created_at: data[i][8]
        });
      }
    }
  }
  // Sort by newest first (descending)
  meetings.sort(function(a, b) {
    return new Date(b.created_at) - new Date(a.created_at);
  });
  
  return { success: true, meetings: meetings };
}

function deleteMeeting(params) {
  var sheet = getSheet("Meetings");
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === params.meetingId && String(data[i][1]).toLowerCase() === String(params.userId).toLowerCase()) {
      // Instead of deleting the row entirely (which messes up indices), we mark it as deleted.
      sheet.getRange(i + 1, 4).setValue("deleted");
      return { success: true };
    }
  }
  return { success: false, error: "Meeting not found or unauthorized to delete" };
}
