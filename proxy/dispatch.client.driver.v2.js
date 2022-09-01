/* eslint-disable new-cap */

(function () {
    var SD = window,
        MatchingResponse = window.MatchingResponse,
        specifyRegistrationForTracking,
        handlePostMessage,
        courseStatus,
        dispatchPolling,

        //
        // add a prefix to all `SD.WriteToDebug` messages because we are piggy
        // backing off its debugging, but someone might think these messages are
        // coming directly from Driver
        //
        logPrefix = "dispatch: ",

        // default to not sending interactions, then only turn on
        // for the standards we can support
        sendInteractions = false,

        //
        // setting this arbitrarily low, the DispatchDriver (server.js) will start
        // sending its messages at 0, so this allows any intermediary parties to
        // send pipe messages through with a negative number (still sequenced) up
        // until the content has actually launched
        //
        lastSequenceNumber = -100,

        processedConcedeMessage = false,
        registrationUpdateDate = null,
        hideErrorDuringTeardown = false,
        unloading = false,
        threeSeconds = 3000,
        initTimeoutId;

    (function () {
        function httpGet (theUrl, successCallback, failCallback) {
            var xmlHttp = new XMLHttpRequest();

            xmlHttp.onreadystatechange = function () {
                // eslint-disable-next-line no-magic-numbers
                if (xmlHttp.readyState === 4) {
                    if (xmlHttp.status === 200) {
                        successCallback(xmlHttp);
                    }
                    else {
                        failCallback(xmlHttp);
                    }
                }
            };

            xmlHttp.open("GET", theUrl, true);
            xmlHttp.send(null);
        }

        //
        // this is only necessary for standards that don't interact with
        // the player for setting status data directly like SCORM does,
        // in other words SCORM sets data directly via the JS API it
        // provides, but AICC, Tin Can, cmi5, etc. bypass the player and
        // communicate directly back to the LMS, so get the status data
        // back from the Engine instance hosting the source package and
        // use the data from the server side to simulate calls being made
        // on the client
        //
        dispatchPolling = {
            isTimerRunning: false,
            timerPeriod: 1500,
            permitInfoRequests: true,
            nextPollTimeout: null,
            isFirstPoll: true,
            url: null,
            networkFailedPollingRequestCount: 0,
            networkFailedPollingRetrySeconds: 30,
            networkFailedPollingRetryCount: 0,

            cacheUrl: function (origRequestUrl, cfg) {
                var requestUrl = origRequestUrl,
                    params = {
                        methodName: "GetRegistration",
                        registrationId: cfg.registrationId
                    },
                    param,
                    count = 0;

                if (typeof cfg.tenant !== "undefined") {
                    params.tenantName = cfg.tenant;
                }
                if (typeof cfg.dispatchId !== "undefined") {
                    params.dispatchId = cfg.dispatchId;
                }

                // Fix request URL if course is launched from HTTP LMS
                if (window.location.protocol !== "https:") {
                    requestUrl = requestUrl.replace("https:", "http:");
                }

                // Allow requestUrl to already have parameters on it, but if it does
                // have a '?' assume it has parameters and we'll be adding to them
                requestUrl += requestUrl.indexOf("?") === -1 ? "?" : "&";

                for (param in params) {
                    if (params.hasOwnProperty(param)) {
                        requestUrl += count > 0 ? "&" : "";
                        requestUrl += param + "=" + params[param];
                        count += 1;
                    }
                }

                dispatchPolling.url = requestUrl;
            },

            updateViaServer: function (successCallback) {
                httpGet(
                    // we tag on the registrationUpdateDate here rather than when creating dispatchPolling.url
                    // otherwise the date will never change and will be pointless.
                    dispatchPolling.url + "&registrationUpdateDate=" + registrationUpdateDate,
                    // eslint-disable-next-line complexity
                    function (xmlHttp) {
                        var parsedResponse = JSON.parse(xmlHttp.responseText),
                            success,
                            completion,
                            score,
                            i,
                            j;

                        // Since we are successful, restart our failed polling request counter
                        dispatchPolling.networkFailedPollingRequestCount = 0;

                        /*
                        {
                            "totalSecondsTracked":127,
                            "successStatus":"FAILED",
                            "completionStatus":"COMPLETE",
                            "scoreIsKnown":true,
                            "score":40.0,
                            "completionStatOfFailedSuccessStat":{"Value":"Unknown"},
                            "updated":"2018-05-22T20:32:45.000+0000",
                            "lastAccessDateUTC":{"Value":"2018-05-22T20:32:45.000+0000"},
                            "creationDateUTC":{"Value":"2018-05-22T17:34:50.000+0000"},
                            "completedDateUTC":{"Value":"2018-05-22T17:37:06.000+0000"},
                            "firstAccessDateUTC":{"Value":"2018-05-22T17:34:57.000+0000"},
                            "xapiregistrationId":"74216ed7-4549-4b24-b5ce-aade6f66f553"
                         }
                         */
                        if (parsedResponse.scoreIsKnown) {
                            score = parseFloat(parsedResponse.score);
                        }

                        if (parsedResponse.completionStatus === 'COMPLETE') {
                            completion = "completed";
                        }
                        else {
                            //
                            // time was that Driver would set `incomplete` explicitly on start up
                            // for SCORM packages, which meant that Dispatched packages (no matter
                            // the source standard) would get incomplete set on launch, we determined
                            // that was bad so disabled it for Dispatch, but that triggered a regression
                            // where for non-SCORM content that never set an incomplete the SCORM
                            // dispatch would get set to complete, so now we make this an explicit
                            // incomplete when not complete (effectively ruling out the possibility of
                            // "unknown")
                            //
                            completion = "incomplete";
                        }
                        if (typeof parsedResponse.successStatus !== 'undefined' && parsedResponse.successStatus !== null && parsedResponse.successStatus !== 'UNKNOWN') {
                            if (parsedResponse.successStatus === 'PASSED') {
                                success = "passed";
                            }
                            else {
                                success = "failed";
                            }
                        }

                        // Update the registrationUpdateDate we have ready for the next poll.
                        registrationUpdateDate = parsedResponse.updated;

                        //
                        // Send interactions if they exist, following format:
                        //
                        // {
                        //     "correctResponse": "t"
                        //     "identifier": "Scene1_Slide3_TrueFalse_0_0"
                        //     "learnerResponse": "t"
                        //     "result": "correct"
                        //     "timestamp": "2016/08/31T15:10:53"
                        //     "type": "true-false"
                        // }
                        //

                        //Cloud does not send interactions to the destination
                        sendInteractions = false;
                        if (sendInteractions) {
                            for (i = 0; i < parsedResponse.activities.length; i += 1) {
                                for (j = 0; j < parsedResponse.activities[i].interactions.length; j += 1) {
                                    courseStatus.recordInteraction(dispatchPolling.isFirstPoll, parsedResponse.activities[i].interactions[j]);
                                }
                            }
                        }
                        courseStatus.updateSummary(
                            {
                                isLaunchState: dispatchPolling.isFirstPoll,
                                completion: completion,
                                success: success,
                                score: score
                            }
                        );

                        dispatchPolling.isFirstPoll = false;

                        successCallback();
                    },
                    function (xmlHttp) {
                        //
                        // this request failed so the third party LMS will not be updated,
                        // go through the rules of how to handle the failure
                        //
                        var alertMsg;

                        //
                        // some customers, those that have `hideErrorDuringTeardown` enabled, don't want an alert
                        // presented to users during the unload process for network errors (0 status), so for that
                        // case go ahead and return now
                        //
                        if (unloading && xmlHttp.status === 0 && hideErrorDuringTeardown) {
                            return;
                        }

                        //
                        // indicate the first poll has happened, even though it was successful because it is possible
                        // that the user ignores the warning, goes on to do something that is considered pertinent
                        // which updates the server such that then on a successful poll we would ignore that change
                        // even though it occurred in this launch session, the problem with doing this though is that
                        // if the first poll fails then a subsequent poll could set status changes that didn't need to
                        // necessarily be set, but that's how dispatch worked for a long time anyways so it is probably
                        // fine
                        //
                        dispatchPolling.isFirstPoll = false;

                        //
                        // keep track of consecutive polling failures
                        //
                        dispatchPolling.networkFailedPollingRequestCount += 1;

                        if (xmlHttp.status === 0) {
                            alertMsg = "network connection issue -- please check your connection to the Internet";
                        }
                        else {
                            alertMsg = "request to retrieve progress failed -- HTTP status '" + xmlHttp.status + "'";
                        }

                        //
                        // For intermittent failures, usually due to network connectivity problems, we want to keep
                        // polling for some time in case the connectivity comes back. We will do the failure action
                        // only after failing for that time (30s).
                        //
                        // eslint-disable-next-line no-magic-numbers
                        if (! unloading && dispatchPolling.networkFailedPollingRequestCount * dispatchPolling.timerPeriod > dispatchPolling.networkFailedPollingRetrySeconds * 1000) {
                            if (dispatchPolling.failureAction === "Continue") {
                                if (dispatchPolling.networkFailedPollingRetryCount === 0) {
                                    // eslint-disable-next-line no-alert
                                    alert("FATAL ERROR: Your progress is NOT being saved! Please exit the course. Error details: " + alertMsg);
                                }
                            }
                            else if (dispatchPolling.failureAction === "Continue_Without_Poll") {
                                //
                                // this is the original behavior where we alert the user once, then allow the course to
                                // continue going but DON'T continue to poll, so there will be no further status updates
                                // which is generally considered bad and we hope no one really uses
                                //
                                if (dispatchPolling.networkFailedPollingRetryCount === 0) {
                                    // eslint-disable-next-line no-alert
                                    alert("FATAL ERROR: Your progress is NOT being saved! Please exit the course. Error details: " + alertMsg);
                                }

                                return;
                            }
                            else if (dispatchPolling.failureAction === "Continue_With_Alert") {
                                // eslint-disable-next-line no-alert
                                alert("FATAL ERROR: Your progress is NOT being saved! Please exit the course. Error details: " + alertMsg);
                            }
                            else if (dispatchPolling.failureAction === "Exit") {
                                // eslint-disable-next-line no-alert
                                alert("FATAL ERROR: Your progress is NOT being saved! Course will exit. Error details: " + alertMsg);

                                SD.ConcedeControl();

                                return;
                            }
                            else if (dispatchPolling.failureAction === "Exit_With_Confirmation") {
                                // eslint-disable-next-line no-alert
                                if (! window.confirm("ERROR: Your progress is NOT being saved! Do you want to continue anyway? Error details: " + alertMsg)) {
                                    SD.ConcedeControl();

                                    return;
                                }
                            }

                            // reset the tracker to start over on next failure
                            dispatchPolling.networkFailedPollingRequestCount = 0;

                            //
                            // keep track of the number of times this has been hit
                            //
                            dispatchPolling.networkFailedPollingRetryCount += 1;
                        }

                        //
                        // getting here indicates that the course will continue and polling should continue
                        // *unless* unloading in which case there isn't any point in setting the next poll
                        //
                        if (! unloading) {
                            dispatchPolling.nextPollTimeout = setTimeout(dispatchPolling.setupPeriodicTimer, dispatchPolling.timerPeriod);
                        }
                    }
                );
            },

            setupPeriodicTimer: function () {
                dispatchPolling.isTimerRunning = true;

                dispatchPolling.updateViaServer(
                    function () {
                        dispatchPolling.nextPollTimeout = setTimeout(dispatchPolling.setupPeriodicTimer, dispatchPolling.timerPeriod);
                    }
                );
            }
        };
    }());

    (function () {
        //
        // using an object to keep track of the current state to reduce the overall
        // number of commit calls necessary, but to allow to commit anytime there
        // is a change that should be reflected
        //
        courseStatus = {
            srcStandard: null,
            completion: null,
            success: null,
            score: {
                min: 0,
                max: 100,
                raw: null
            },
            duration: null,
            sentInteractionIds: [],
            _interactionTypeToDriverFunctionMap: {
                "true-false": SD.RecordTrueFalseInteraction,
                choice: SD.RecordMultipleChoiceInteraction,
                "fill-in": SD.RecordFillInInteraction,
                "long-fill-in": SD.RecordFillInInteraction,
                matching: SD.RecordMatchingInteraction,
                performance: SD.RecordPerformanceInteraction,
                sequencing: SD.RecordSequencingInteraction,
                likert: SD.RecordLikertInteraction,
                numeric: SD.RecordNumericInteraction
            },

            parseSummaryParam: function (param) {
                if (typeof param !== "undefined" && param !== "null" && param !== "unknown") {
                    return param;
                }

                return null;
            },

            isSrcScorm12: function () {
                return this.srcStandard === "scorm12";
            },

            isSrcScorm2004: function () {
                if (this.srcStandard === null) {
                    return false;
                }

                // use .indexOf because SCORM 2004 includes the edition, but
                // all editions get treated the same by us
                return this.srcStandard.indexOf("scorm2004") !== -1;
            },

            isSrcAicc: function () {
                return this.srcStandard === "aicc";
            },

            getResponseIdentifier: function (response) {
                var driverPrefix = "urn:scormdriver:",
                    shortId;

                //
                // we can be smart about certain content we recognize here,
                // in other words we know Driver tacks on `urn:scormdriver:`
                // to make 2004 identifiers when they aren't already valid,
                // so we can back that off when going from 2004 to 1.2 to
                // potentially get back to a better identifier
                //
                if (this.isSrcScorm2004() && SD.objLMS.Standard === "SCORM" && response.indexOf(driverPrefix) === 0) {
                    shortId = response.substr(driverPrefix.length).substr(0, 1);
                }
                else {
                    shortId = response.substr(0, 1);
                }

                return SD.CreateResponseIdentifier(shortId, response);
            },

            doesLaunchStateImproveStatus: function (cfg) { // eslint-disable-line complexity
                // if the launch state has a better status than what driver has disable launch state and update our values accordingly.
                if (SD.objLMS.Standard === "SCORM" || SD.objLMS.Standard === "AICC") {
                    if (cfg.success === "passed" && SD.GetStatus() !== SD.LESSON_STATUS_PASSED) {
                        return true;
                    }
                    else if ((cfg.completion === "completed" || cfg.completion === "complete") && (SD.GetStatus() !== SD.LESSON_STATUS_COMPLETED && SD.GetStatus() !== SD.LESSON_STATUS_PASSED)) {
                        return true;
                    }
                    else if (cfg.success === "failed" && (SD.GetStatus() === SD.LESSON_STATUS_INCOMPLETE || SD.GetStatus() === SD.LESSON_STATUS_BROWSED || SD.GetStatus() === SD.LESSON_STATUS_NOT_ATTEMPTED)) {
                        return true;
                    }
                    else if (cfg.score !== "unknown" && cfg.score > SD.GetScore()) {
                        return true;
                    }
                }
                else if (SD.objLMS.Standard === "SCORM2004") {
                    if (cfg.success === "passed" && SD.SCORM2004_CallGetValue("cmi.success_status") !== "passed") {
                        return true;
                    }
                    else if ((cfg.completion === "completed" || cfg.completion === "complete") && SD.SCORM2004_CallGetValue("cmi.completion_status") !== "completed") {
                        return true;
                    }
                    else if (cfg.score !== "unknown" && cfg.score > SD.GetScore()) {
                        return true;
                    }
                }

                return false;
            },

            updateCompletion: function (completion, isLaunchState) {
                var newCompletion = this.parseSummaryParam(completion),
                    needsCommit = false;

                if (newCompletion !== this.completion) {
                    SD.WriteToDebug(logPrefix + "Setting completion status to " + newCompletion);

                    //
                    // completion is a bit different because we want to set incomplete even in the
                    // launch state case, so check to see if it is completed and if so only set it
                    // in the non-launch case, otherwise always set incomplete when the dispatch
                    // hasn't yet set it in this launch session
                    //
                    if (newCompletion === "completed" || newCompletion === "complete") {
                        if (! isLaunchState) {
                            SD.SetReachedEnd();
                            needsCommit = true;
                        }
                    }
                     else if (newCompletion === "incomplete") {
                        //
                        // Driver's public interface doesn't provide a way to explicitly set
                        // a completion status of incomplete, so we use a non-public interface
                        // to do so knowing that theoretically we know what we're doing, if
                        // Driver exposes a public interface to set incomplete this should get
                        // updated to leverage it
                        //
                        // in 1.2 there is only 1 status setting, so if it has already been set
                        // (aka is Passed or Failed) then don't set incomplete
                        if (SD.objLMS.Standard === "SCORM" && ! SD.blnStatusWasSet) {
                            SD.SCORM_CallLMSSetValue("cmi.core.lesson_status", "incomplete");
                            needsCommit = true;
                        }
                        else if (SD.objLMS.Standard === "SCORM2004") {
                            SD.SCORM2004_CallSetValue("cmi.completion_status", "incomplete");
                            needsCommit = true;
                        }
                    }

                    this.completion = newCompletion;
                }

                return needsCommit;
            },

            updateSuccess: function (success, isLaunchState) {
                var newSuccess = this.parseSummaryParam(success);

                if (typeof newSuccess !== "undefined" && newSuccess !== this.success) {
                    SD.WriteToDebug(logPrefix + "Setting success status to " + newSuccess);
                    if (newSuccess !== "passed" && newSuccess !== "failed") {
                        SD.WriteToDebug(logPrefix + "Unrecognized success status value: " + newSuccess);

                        return false;
                    }

                    this.success = newSuccess;

                    if (! isLaunchState) {
                        if (newSuccess === "passed") {
                            SD.SetPassed();
                        } else if (newSuccess === "failed") {
                            SD.SetFailed();
                        }

                        return true;
                    }
                }

                return false;
            },

            updateScore: function (score, isLaunchState) {
                var newScore = this.parseSummaryParam(score);

                if (typeof newScore !== "undefined" && newScore !== this.score.raw) {
                    if (! isLaunchState) {
                        SD.WriteToDebug(logPrefix + "Setting score to " + newScore);
                        SD.SetScore(newScore, this.score.max, this.score.min);
                    }
                    this.score.raw = newScore;

                    return true;
                }

                return false;
            },

            updateDuration: function (duration) {
                var newDuration = this.parseSummaryParam(duration);

                if (typeof newDuration !== "undefined" && newDuration !== this.duration) {
                    SD.WriteToDebug(logPrefix + "Setting session time to " + newDuration);
                    // Session time from dispatch is in hundredths of
                    // a second, but Driver takes milliseconds.
                    SD.SetSessionTime(Math.ceil(newDuration * 10)); // eslint-disable-line no-magic-numbers
                    this.duration = newDuration;

                    return true;
                }

                return false;
            },

            updateSummary: function (cfg) {
                var needCommit;

                SD.WriteToDebug(logPrefix + "calling out to SD methods for completion: " + cfg.completion + ", success: " + cfg.success + ", score: " + cfg.score + ", duration: " + cfg.duration + ")");

                if (typeof cfg.duration !== "undefined") {
                    this.updateDuration(cfg.duration);
                }

                //
                // the `isLaunchState` property allows the dispatch to know whether it
                // is the state being passed through initially at launch and therefore
                // doesn't need to record values for what should have been previously
                // recorded from a prior session, so that it can discern what is being
                // explicitly set during this session and therefore only make the new
                // appropriate calls
                //
                // the following logic is used to fix when there is a mismatch between the
                // state Engine passes through at launch and what the learner currently has
                //

                if (cfg.isLaunchState) {
                    if (courseStatus.launchStateOverride === "Content_Root_Preferred") {
                        SD.WriteToDebug("Setting isLaunchState to false based on launchStateOverride setting of Content_Root_Preferred");
                        cfg.isLaunchState = false;
                    }
                    else if (courseStatus.launchStateOverride === "Learner_Preferred") {
                        if (this.doesLaunchStateImproveStatus(cfg)) {
                            SD.WriteToDebug("Setting isLaunchState to false based on launchStateOverride setting of Learner_Preferred and improved state in SetSummary data");
                            cfg.isLaunchState = false;
                        }
                    }
                }

                // order matters here:
                //
                // update score because at least one LMS we've found doesn't
                // bother recording a score if it has already seen a completion
                // so do score first (at least until we find an LMS that ignores
                // completion after seeing a score)
                //
                // update completion next because 1.2 only has 1 status setting,
                // and we favor knowing pass/fail over completion in that case,
                // for 2004 see Driver config for PASS_FAIL_SETS_COMPLETION_FOR_2004,
                // additionally see comment in `updateCompletion` about the hack
                // we do for setting incomplete
                //

                needCommit = this.updateScore(cfg.score, cfg.isLaunchState);
                needCommit = this.updateCompletion(cfg.completion, cfg.isLaunchState) || needCommit;
                needCommit = this.updateSuccess(cfg.success, cfg.isLaunchState) || needCommit;

                if (needCommit) {
                    SD.CommitData();
                }
            },

            // eslint-disable-next-line complexity
            recordInteraction: function (isLaunchState, interaction) {
                var result,
                    learnerResponse,
                    correctResponse,
                    latency = null,
                    responseDelimiter,
                    matchDelimiter,
                    parts,
                    i;

                if (this.sentInteractionIds.indexOf(interaction.identifier) !== -1) {
                    return;
                }
                if (typeof this._interactionTypeToDriverFunctionMap[interaction.type] === "undefined") {
                    SD.WriteToDebug(logPrefix + "unrecognized interaction type will not get recorded: " + interaction.type);

                    return;
                }

                //
                // convert the possible results from their more specific standards to the generic
                // ones Driver expects, so that it will convert to the dispatched standard as
                // appropriate but do it simply because they match other than for "wrong"
                //
                // For the concept of incorrect interactions SCORM1.2 and SCORM2004 specify either
                // "incorrect" or "wrong", AICC stores this concept as "" and distinguishes it from
                // the unanticipated and neutral concepts, cmi5 and Tin Can don't support either
                // of those so they are returned as "" and we don't set an `interaction.result` at
                // all, but for them incorrect is specified as "wrong" so it gets set correctly
                //
                if (interaction.result === "correct") {
                    result = SD.INTERACTION_RESULT_CORRECT;
                }
                else if (interaction.result === "wrong" || interaction.result === "incorrect" || (interaction.result === "" && this.isSrcAicc())) {
                    result = SD.INTERACTION_RESULT_WRONG;
                }
                else if (interaction.result === "unanticipated") {
                    result = SD.INTERACTION_RESULT_UNANTICIPATED;
                }
                else if (interaction.result === "neutral") {
                    result = SD.INTERACTION_RESULT_NEUTRAL;
                }

                learnerResponse = interaction.learnerResponse;

                //
                // Driver currently only supports setting 1 correct response pattern (0 index)
                // so if given an array of correct response patterns take only the first
                //
                correctResponse = interaction.correctResponse;
                if (Object.prototype.toString.call(correctResponse) === "[object Array]") {
                    if (typeof correctResponse[0] === "undefined") {
                        correctResponse = null;
                    }
                    else {
                        correctResponse = correctResponse[0];
                    }
                }

                if (interaction.type === "true-false") {
                    if (learnerResponse !== null) {
                        learnerResponse = SD.ConvertStringToBoolean(learnerResponse);
                    }
                    if (correctResponse !== null) {
                        correctResponse = SD.ConvertStringToBoolean(correctResponse);
                    }
                }
                else if (interaction.type === "choice" || interaction.type === "sequencing") {
                    responseDelimiter = "[,]";
                    if (this.isSrcScorm12() || this.isSrcAicc()) {
                        responseDelimiter = ",";
                    }

                    if (learnerResponse !== null) {
                        learnerResponse = learnerResponse.split(responseDelimiter);
                        for (i = 0; i < learnerResponse.length; i += 1) {
                            learnerResponse[i] = this.getResponseIdentifier(learnerResponse[i]);
                        }
                    }

                    if (correctResponse !== null) {
                        correctResponse = correctResponse.split(responseDelimiter);
                        for (i = 0; i < correctResponse.length; i += 1) {
                            correctResponse[i] = this.getResponseIdentifier(correctResponse[i]);
                        }
                    }
                }
                else if (interaction.type === "performance") {
                    if (! this.isSrcScorm12()) {
                        responseDelimiter = "[.]";

                        if (learnerResponse !== null && learnerResponse.indexOf(responseDelimiter) === 0) {
                            learnerResponse = learnerResponse.substr(responseDelimiter.length);
                        }
                        if (correctResponse !== null && correctResponse.indexOf(responseDelimiter) === 0) {
                            correctResponse = correctResponse.substr(responseDelimiter.length);
                        }
                    }
                }
                else if (interaction.type === "likert") {
                    if (learnerResponse !== null) {
                        learnerResponse = this.getResponseIdentifier(learnerResponse);
                    }
                    if (correctResponse !== null) {
                        correctResponse = this.getResponseIdentifier(correctResponse);
                    }
                }
                else if (interaction.type === "matching") {
                    responseDelimiter = "[,]";
                    matchDelimiter = "[.]";
                    if (this.isSrcScorm12() || this.isSrcAicc()) {
                        responseDelimiter = ",";
                        matchDelimiter = ".";
                    }

                    if (learnerResponse !== null) {
                        learnerResponse = learnerResponse.split(responseDelimiter);
                        for (i = 0; i < learnerResponse.length; i += 1) {
                            parts = learnerResponse[i].split(matchDelimiter);

                            learnerResponse[i] = new MatchingResponse(
                                this.getResponseIdentifier(parts[0]),
                                this.getResponseIdentifier(parts[1])
                            );
                        }
                    }

                    if (correctResponse !== null) {
                        correctResponse = correctResponse.split(responseDelimiter);
                        for (i = 0; i < correctResponse.length; i += 1) {
                            parts = correctResponse[i].split(matchDelimiter);

                            correctResponse[i] = new MatchingResponse(
                                this.getResponseIdentifier(parts[0]),
                                this.getResponseIdentifier(parts[1])
                            );
                        }
                    }
                }

                //
                // Driver will stringify these values to `"undefined"`
                // if they aren't provided, so make sure they are provided,
                // but in these cases Driver won't record them
                //
                latency = null;
                if (typeof interaction.latency !== "undefined") {
                    // this works for both SCORM 1.2 and SCORM 2004 source packages
                    // and the others don't return latency from the server
                    latency = SD.ConvertScorm2004TimeToMS(interaction.latency);
                }

                if (typeof interaction.weighting === "undefined") {
                    interaction.weighting = null;
                }
                if (typeof interaction.learningObjectiveId === "undefined") {
                    interaction.learningObjectiveId = "";
                }

                if (! isLaunchState) {
                    this._interactionTypeToDriverFunctionMap[interaction.type](
                        interaction.identifier,
                        learnerResponse,
                        result,
                        correctResponse,
                        interaction.description,
                        interaction.weighting,
                        latency,
                        interaction.learningObjectiveId
                    );
                    SD.CommitData();
                }

                this.sentInteractionIds.push(interaction.identifier);
            }
        };
    }());

    // eslint-disable-next-line max-params
    specifyRegistrationForTracking = function (registrationId, standard, tenant, dispatchId, requestUrl, pollingFrequency, pollingFailureAction, masteryScoreOverrideBehavior, launchStateOverride) {
        SD.SetDataChunk(registrationId);

        if (typeof standard !== "undefined") {
            courseStatus.srcStandard = standard;
            courseStatus.launchStateOverride = launchStateOverride;

            // We do polling for status for all standards other than SCORM
            if (standard.indexOf("scorm") === -1) {
                SD.WriteToDebug(logPrefix + "starting server polling based on learning standard (" + standard + ")");
                dispatchPolling.cacheUrl(
                    requestUrl,
                    {
                        registrationId: registrationId,
                        tenant: tenant,
                        dispatchId: dispatchId
                    }
                );

                // The polling frequency should be provided through the DispatchPollingFrequency configuration. Provide
                // a default value here as a sanity check in case the determined config value is undefined. Use 1500ms
                // as the default value in those cases.
                dispatchPolling.timerPeriod = pollingFrequency || 1500; // eslint-disable-line no-magic-numbers

                // what to do when polling fails should be passed through just like the frequency, but set a default
                // that matches the expected default for the configuration setting
                dispatchPolling.failureAction = pollingFailureAction || "Continue";

                dispatchPolling.setupPeriodicTimer();
            }
        }
    };

    //
    // This post message handler is the important one, handles any messages received
    // from the external domain's content. The message is then translated into a call
    // to the SD (Driver) interface which ultimately makes the SCORM/AICC API call on
    // the 3rd party LMS via the dispatched package.
    //
    // eslint-disable-next-line complexity
    handlePostMessage = function (evt) {
        var rawMsg = evt.data,
            msg;

        SD.WriteToDebug(logPrefix + "handling message: " + rawMsg);

        try {
            msg = JSON.parse(rawMsg);
        }
        catch (ex) {
            SD.WriteToDebug(logPrefix + "failed to parse message as JSON (likely not a dispatch message). Parse Error: " + ex + ", msg: '" + rawMsg + "'");

            return;
        }

        if (! msg.rusticiSoftwareDispatch) {
            SD.WriteToDebug(logPrefix + "failed to detect 'rusticiSoftwareDispatch' property in JSON message (likely not a dispatch message), msg: '" + rawMsg + "'");

            return;
        }

        //
        // this message is sent by Closer.html, which is the RedirectOnExitUrl set up in
        // dispatch.client.loader.js. receiving this message indicates that the host player
        // has been exited, so we should call ConcedeControl to exit the remote player.
        //
        // in the case of AICC, Tin Can, and cmi5 Dispatch, that also means we should update
        // the registration summary before exiting, since it might've changed since the last
        // registration summary poll happened.
        //
        // this if-statement is separate from the regular message processing code below because
        // the Closer.html page does not have the correct sequence number to send.
        //
        if (msg.action === "Closer_ConcedeControl") {
            if (processedConcedeMessage) {
                return;
            }

            // prevent processing this message more than once
            processedConcedeMessage = true;

            if (dispatchPolling.isTimerRunning) {
                dispatchPolling.updateViaServer(
                    function () {
                        SD.WriteToDebug(logPrefix + "calling out to SD.ConcedeControl()");
                        SD.ConcedeControl();
                    }
                );

                return;
            }

            SD.WriteToDebug(logPrefix + "calling out to SD.ConcedeControl()");
            SD.ConcedeControl();

            return;
        }

        if (msg.sequenceNumber <= lastSequenceNumber) {
            return;
        }

        lastSequenceNumber = msg.sequenceNumber;

        msg.cfg = msg.cfg || {};

        //
        // wrap these calls in a `try/catch` because the underlying Driver call
        // is ultimately communicating with the 3rd party LMS' implementation which
        // could `throw` for some reason
        //
        // it would be better to move this protection to Driver itself, then leverage
        // Driver's error handling mechanism and then we could alert the user upon
        // seeing the error from Driver
        //
        try {
            if (msg.action === "ShowContent") {
                //
                // pipe is established and working, clear our timeout
                //
                window.clearTimeout(initTimeoutId);

                if (typeof msg.cfg.registrationId !== "undefined") {
                    specifyRegistrationForTracking(
                        msg.cfg.registrationId,
                        msg.cfg.standard, msg.cfg.tenant,
                        msg.cfg.dispatchId,
                        msg.cfg.requestUrl,
                        msg.cfg.pollingFrequency,
                        msg.cfg.pollingFailureAction,
                        msg.cfg.masteryScoreOverrideBehavior,
                        msg.cfg.launchStateOverride
                    );
                    hideErrorDuringTeardown = msg.cfg.hideErrorDuringTeardown;
                }

                // If this element exists, this v2 dispatch is still using the deprecated "frameset",
                // so we still want to include this just in case
                let dispatchFrame = document.getElementById("dispatch_frameset");
                if (dispatchFrame) {
                    dispatchFrame.rows = "*,0";
                }

                // hide content loading and show content iframe
                document.getElementById("dispatch_loading_frame").style.display = "none";
                document.getElementById("dispatch_content_frame").style.display = "";
            }
            else if (msg.action === "SetSummary") {
                courseStatus.updateSummary(msg.cfg);
            }
            else if (msg.action === "RecordInteraction") {
                if (sendInteractions) {
                    courseStatus.recordInteraction(msg.cfg.isLaunchState, msg.cfg.interaction);
                }
            }
            else {
                throw new Error("Unrecognized pipe message action: " + msg.action);
            }
        }
        catch (e) {
            SD.WriteToDebug(logPrefix + "error in set call " + msg.action + ":: Error: " + e);

            //
            // catching an exception here means the 3rd party LMS probably was not
            // updated as expected, let the user know that data may be lost
            //
            // eslint-disable-next-line no-alert
            alert("Failed call to 3rd party LMS (data may have been lost): " + rawMsg);
        }
    };

    //
    // Attach an event handler for HTML5 postMessage events which DispatchDriver will post
    //
    try {
        window.addEventListener(
            "message",
            handlePostMessage,
            false
        );
    }
    catch (ex) {
        // eslint-disable-next-line no-alert
        alert("Failed to add 'message' event listener (data will be lost) - unsupported browser: " + ex);
    }

    window.addEventListener("beforeunload", function () {
        unloading = true;
        setTimeout(function () {
            // In case some other frame stops the unload process, set the unloading flag back to
            // false after a couple of seconds
            unloading = false;
        }, threeSeconds);
    });

    //
    // We can't know whether the DispatchDriver will get set up successfully, so instead
    // create a timeout that will get turned off if the communication pipe is working
    // correctly, otherwise notify the user that data may get lost
    //
    initTimeoutId = window.setTimeout(
        function () {
            // eslint-disable-next-line no-alert
            alert("Failed to receive initial pipe message from dispatch driver - data may be lost");
        },
        30000 // eslint-disable-line no-magic-numbers
    );
}());