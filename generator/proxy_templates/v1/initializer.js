const FC = {

  initialize: function (cfg) {
    const lmsAPI = getScormAPI()
    lmsAPI && lmsAPI.LMSInitialize()
    this.loadLauncherFrame(lmsAPI, cfg)
    this.registerPostEventListener(lmsAPI)
  },
  loadLauncherFrame: function (lmsAPI, cfg) {
    let studentId = ''
    let studentName = ''

    if (lmsAPI) {
      studentId = lmsAPI.LMSGetValue('cmi.core.student_id')
      studentName = lmsAPI.LMSGetValue('cmi.core.student_name')
    }

    let frameUrl = cfg.launcherUrl.replace('{STUDENT_ID}', encodeURIComponent(studentId))
        .replace("{STUDENT_NAME}", encodeURIComponent(studentName))
        .replace("{REFERRING_URL}", encodeURIComponent(cfg.referringUrl))
        .replace("{RESOURCE_ID}", encodeURIComponent(cfg.resourceId))

    if (window.location.protocol === "http:") {
      frameUrl = frameUrl.replace("https://", 'http://')
    }

    document.getElementById(cfg.contentFrameId).src = frameUrl
  },

  /**
   * Registers event listener to parse incoming SCORM messages from FC SCORM to the third party LMS
   */
  registerPostEventListener: function (lmsAPI) {

    if (!lmsAPI) {
      this.log("No SCORM API Found. Third party communication won't work")
      return
    }

    //https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
    window.addEventListener("message", (event) => {

      const parsed = this.parsePostMessage(event.data)

      if (!parsed) {
        this.log("Received message is not valid JSON. Ignoring.")
        return
      }

      if (!parsed.hasOwnProperty('action') || !parsed.hasOwnProperty('arguments')) {
        this.log("Unexpected message. Ignoring", parsed)
        return
      }

      this.log('Event received in proxy', parsed)

      switch (parsed.action) {
        case "LMSGetValue":
          lmsAPI.LMSGetValue(parsed.arguments['key'])
          break
        case "LMSSetValue":
          lmsAPI.LMSGetValue(parsed.arguments['key'], parsed.arguments['value'])
          break
        case "LMSCommit":
        case "LMSFinish":
          lmsAPI[parsed.action]()
          break
      }
    }, false);
  },

  parsePostMessage: function (msg) {
    try {
      return JSON.parse(msg)
    } catch (e) {
      return null
    }
  },
  log: function () {
    console.info(...arguments)
  }
}


function scanParentsForAPI(win) {
  var MAX_PARENTS_TO_SEARCH = 500;
  var nParentsSearched = 0;
  while ((win.API == null || win.API === undefined) && win.parent != null && win.parent != win && nParentsSearched <= MAX_PARENTS_TO_SEARCH) {
    nParentsSearched++;
    win = win.parent;
  }
  return win.API;
}

function getScormAPI() {
  var API = null;
  if (window.parent != null && window.parent != window) {
    API = scanParentsForAPI(window.parent);
  }
  if (API == null && window.top.opener != null) {
    API = scanParentsForAPI(window.top.opener);
  }
  return API;
}

