/* eslint-disable new-cap */
/* globals DispatchRoot, DispatchVersion, ContentURL, DefaultCssUrl, objLMS, ENTRY_FIRST_TIME, PreLaunchConfigurationURL, CryptoJS, IsLtiDispatch */

(function () {
    function locationBaseName (location) {
        var protocol = location.protocol,
            host = location.host,
            originalPathname = location.pathname,
            pathParts = originalPathname.split("/"),
            finalPathname;

        pathParts.pop();
        finalPathname = pathParts.join("/");

        return [protocol, "//", host, finalPathname].join("");
    }

    function trimAndCollapseWhitespace(str) {
        str = str.replace(/^\s+|\s+$/g, ""); // trim spaces off ends
        str = str.replace(/\s{2,}/g, " "); // collapse consecutive whitespace
        return str;
    }

    function getLearnerNameParts (learnerName) {
        var nameParts = [],
            spaceIndex;

        if (learnerName.indexOf(",") >= 0) {
            nameParts = learnerName.split(",");

            if (nameParts.length === 1) {
                if (nameParts[0].length < 1) {
                    return ["Unknown", "Learner"];
                } else {
                    return [nameParts[0], nameParts[0]];
                }

            }
            else if (nameParts.length === 0) {
                return ["Unknown", "Learner"];
            }
        }
        else if (learnerName.indexOf(" ") >= 0) {
            spaceIndex = learnerName.indexOf(" ");

            // last name
            nameParts.push(learnerName.substr(spaceIndex + 1));

            // first name
            nameParts.push(learnerName.substr(0, spaceIndex));
        }
        else {
            nameParts = [learnerName, "Learner"];
        }

        nameParts[0] = trimAndCollapseWhitespace(nameParts[0]);
        nameParts[1] = trimAndCollapseWhitespace(nameParts[1]);

        if (nameParts[0] === "") {
            nameParts[0] = "Unknown";
        }
        if (nameParts[1] === "") {
            nameParts[1] = "Learner";
        }

        return nameParts;
    }

    function templateReplace (template, replacements) {
        return template.replace(
            /{{([^}]+)}}/g,
            function (m, k) {
                return typeof replacements[k] !== "undefined" ? replacements[k] : m;
            }
        );
    }

    function getQueryStringParams (qs) {
        var urlParams = {},
            match,
            search = /([^&=]+)=?([^&#]*)/g;

        while ((match = search.exec(qs)) !== null) {
            urlParams[match[1]] = decodeURIComponent(match[2]);
        }

        return urlParams;
    }

    function buildQueryString (params) {
        var result = "",
            k;

        for (k in params) {
            if (params.hasOwnProperty(k)) {
                if (result !== "") {
                    result += "&";
                }
                result += k + "=" + encodeURIComponent(params[k]);
            }
        }

        return result;
    }

    function switchContentUrlToUseLaunchToken (contentUrl, token) {
        var url = contentUrl,
            splitUrl = url.split("?"),
            urlParams = getQueryStringParams(splitUrl[1]);

        delete urlParams.dispatchId;
        delete urlParams.launchtoken;

        urlParams.launchtoken = token;

        //
        // code here assumes that the URL did not have a hash (#) portion
        //
        url = splitUrl[0] + "?" + buildQueryString(urlParams);

        return url;
    }

    function initialize (cfg) {
        var invalidRegIdRegEx = /[^-\w.]+/,
            now = new Date(),
            buster = now.getYear()+now.getMonth()+now.getDay()+now.getHours(),

            // we modify these so copy the values first
            contentUrl = cfg.contentUrl,
            redirectUrl = cfg.dispatchRoot + "Closer.v2.html",
            defaultCssUrl = cfg.cssUrl,
            learnerId = cfg.learnerId,
            learnerNameFirst,
            learnerNameLast,
            pipeDomain,
            script;

        // Fix links to be SSL when launching in SSL
        if (cfg.currentLocation.protocol === "https:") {
            contentUrl = contentUrl.replace("http:", "https:");
            redirectUrl = redirectUrl.replace("http:", "https:");

            if (typeof defaultCssUrl !== "undefined") {
                defaultCssUrl = defaultCssUrl.replace("http:", "https:");
            }
        }
        else {
            contentUrl = contentUrl.replace("https:", "http:");
            redirectUrl = redirectUrl.replace("https:", "http:");

            if (typeof defaultCssUrl !== "undefined") {
                defaultCssUrl = defaultCssUrl.replace("https:", "http:");
            }
        }

        cfg.options = cfg.options || {};
        if (typeof cfg.options.learnerIdTemplate === "undefined") {
            cfg.options.learnerIdTemplate = "{{learnerId}}";
        }
        if (typeof cfg.options.learnerFirstNameTemplate === "undefined") {
            cfg.options.learnerFirstNameTemplate = "{{learnerFirstName}}";
        }
        if (typeof cfg.options.learnerLastNameTemplate === "undefined") {
            cfg.options.learnerLastNameTemplate = "{{learnerLastName}}";
        }

        if (typeof cfg.options.launchToken !== "undefined") {
            //
            // the prelaunch config URL must have responded with a launch token,
            // so use it in the content URL instead of the dispatch id and launch
            // secret to keep them out of URLs for security reasons, the launch
            // token should be a short lived token that provides a way to verify
            // the launch and the dispatch id
            //
            contentUrl = switchContentUrlToUseLaunchToken(contentUrl, cfg.options.launchToken);
        }

        //
        // calls to CryptoJS.SHA256 return a TypedArray which doesn't
        // have .replace without first being stringified
        //
        learnerId = templateReplace(
            cfg.options.learnerIdTemplate,
            {
                learnerId: learnerId,
                learnerIdHash: CryptoJS.SHA256(learnerId).toString(CryptoJS.enc.Hex)
            }
        );
        learnerNameLast = templateReplace(
            cfg.options.learnerLastNameTemplate,
            {
                learnerLastName: cfg.learnerNameParts[0],
                learnerLastNameHash: CryptoJS.SHA256(cfg.learnerNameParts[0]).toString(CryptoJS.enc.Hex)
            }
        );
        learnerNameFirst = templateReplace(
            cfg.options.learnerFirstNameTemplate,
            {
                learnerFirstName: cfg.learnerNameParts[1],
                learnerFirstNameHash: CryptoJS.SHA256(cfg.learnerNameParts[1]).toString(CryptoJS.enc.Hex)
            }
        );

        learnerId = learnerId.replace(/[\\/]/g, "_");
        contentUrl = contentUrl.replace("LEARNER_ID", encodeURIComponent(learnerId));

        contentUrl = contentUrl.replace("LEARNER_LNAME", encodeURIComponent(learnerNameLast));
        contentUrl = contentUrl.replace("LEARNER_FNAME", encodeURIComponent(learnerNameFirst));

        contentUrl = contentUrl.replace("REFERRING_URL", encodeURIComponent(cfg.currentLocation));

        pipeDomain = locationBaseName(cfg.currentLocation);
        contentUrl = contentUrl.replace("PIPE_URL", encodeURIComponent(pipeDomain));

        contentUrl = contentUrl.replace("REDIRECT_URL", encodeURIComponent(redirectUrl));

        // CSS_URL doesn't appear in the ContentUrl generated in packages from Engine currently
        // but did in the past, and so this is left in for backwards compatibility
        if (typeof defaultCssUrl !== "undefined") {
            contentUrl = contentUrl.replace("CSS_URL", encodeURIComponent(defaultCssUrl));
        }

        if (cfg.isLti) {
            contentUrl = contentUrl.replace("_REGISTRATION_ARGUMENT", "&regid=_lti_");
        }
        else if (cfg.entryMode === ENTRY_FIRST_TIME) {
            contentUrl = contentUrl.replace("_REGISTRATION_ARGUMENT", "&regid=_new_");
        }
        else if (cfg.regId !== null && cfg.regId !== "" && ! invalidRegIdRegEx.test(cfg.regId)) {
            contentUrl = contentUrl.replace("_REGISTRATION_ARGUMENT", "&regid=" + encodeURIComponent(cfg.regId));
        }
        else if (typeof cfg.dispatchVersion !== "undefined" && cfg.dispatchVersion > 0) {
            // there should be reg info, but there isn't
            contentUrl = contentUrl.replace("_REGISTRATION_ARGUMENT", "&regid=_none_");
        }
        else {
            contentUrl = contentUrl.replace("_REGISTRATION_ARGUMENT", "");
        }

        //
        // this used to occur in a frame in the page that loads this script, but for
        // various reasons that has changed, but we can't change that page because
        // it is in the dispatch packages themselves, so instead load it here
        //
        script = document.createElement("script");
        script.async = true;
        script.src = cfg.dispatchRoot + "dispatch.client.driver.v2.js?cachebuster=" + buster;
        script.onload = function () {
            if (! script.readyState || /loaded|complete/.test(script.readyState)) {
                clearTimeout(cfg.timeoutId);

                script.parentNode.removeChild(script);
                script = null;

                // Navigate to the proper place...
                window.dispatch_loading_frame.document.location.href = cfg.dispatchRoot + "loading.html";
                window.dispatch_content_frame.document.location.href = cfg.dispatchRoot + "DispatchHost.v2.html?cachebuster=" + buster + "&URL=" + encodeURIComponent(contentUrl) + "#" + pipeDomain;
            }
        };

        document.getElementsByTagName("head")[0].appendChild(script);
    }

    function initializeWithPrelaunch (prelaunchConfigUrl, initCfg) {
        var url = prelaunchConfigUrl,
            splitUrl = url.split("?"),
            urlParams,
            useHeaders = false,
            dispatchId,
            launchToken,
            xhr;

        if (splitUrl.length === 2) { // eslint-disable-line no-magic-numbers
            urlParams = getQueryStringParams(splitUrl[1]);

            if (typeof urlParams.dispatchId !== "undefined" && typeof urlParams.launchtoken !== "undefined") {
                //
                // Engine added the ability to provide back a signed, expirable launch token rather than
                // launching directly with the dispatch id + launch secret, so we need to move those values
                // to headers in the request to prevent them being sent over the URL for security reasons
                // and then do the same to the content URL if the prelaunch response includes a launch token,
                // and then re-build the URL without those parameters
                //
                useHeaders = true;

                dispatchId = urlParams.dispatchId;
                launchToken = urlParams.launchtoken;

                delete urlParams.dispatchId;
                delete urlParams.launchtoken;

                //
                // code here assumes that the URL did not have a hash (#) portion
                //
                url = splitUrl[0] + "?" + buildQueryString(urlParams);
            }
        }

        xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);

        if (useHeaders) {
            // calls to setRequestHeader must be made after .open and before .send
            xhr.setRequestHeader("DispatchId", dispatchId);
            xhr.setRequestHeader("DispatchToken", launchToken);
        }

        xhr.onreadystatechange = function () {
            // eslint-disable-next-line no-magic-numbers
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        initCfg.options = JSON.parse(xhr.responseText);
                    }
                    catch (ex) {
                        // eslint-disable-next-line no-alert
                        alert("Failed to parse response from pre-launch configuration URL as JSON, the launch has been halted. (" + ex + ")");

                        return;
                    }

                    initialize(initCfg);

                    return;
                }

                // eslint-disable-next-line no-alert
                alert("Unrecognized HTTP status returned from pre-launch configuration URL (" + xhr.status + "), the launch has been halted.");
            }
        };

        try {
            xhr.send();
        }
        catch (ex) {
            // research indicates that IE is known to just throw exceptions
            // on .send and it seems everyone just ignores them
        }
    }

    window.LoadContent = function () {
        var initCfg = {
                currentLocation: window.location,
                contentUrl: ContentURL,
                dispatchRoot: DispatchRoot,
                dispatchVersion: DispatchVersion
            };

        //
        // This is silly and kludgy, but the only way to make up for a misnaming in dispatch.html
        // without requiring a new dispatch download is to create an alias for dispatch_content_frame
        // to scormdriver_content, which the SCORM Driver expects in some parts of its code,
        // specifically some exit code in ConcedeControl that will close or redirect the window.
        //
        // eslint-disable-next-line camelcase
        window.scormdriver_content = window.dispatch_content_frame;

        if (initCfg.contentUrl === "") {
            // eslint-disable-next-line no-alert
            alert("ERROR - no ContentURL specified");

            return false;
        }

        initCfg.learnerId = objLMS.GetStudentID();
        if (initCfg.learnerId === null || initCfg.learnerId.length === 0) {
            // eslint-disable-next-line no-alert
            alert("The host LMS for this dispatch returned an empty learner id. Since the learner id is required for dispatch, the launch has been halted.");

            return false;
        }

        initCfg.learnerNameParts = getLearnerNameParts(objLMS.GetStudentName());
        initCfg.entryMode = objLMS.GetEntryMode();
        if (initCfg.entryMode !== ENTRY_FIRST_TIME) {
            initCfg.regId = objLMS.GetDataChunk();
        }

        if (typeof IsLtiDispatch !== "undefined" && IsLtiDispatch) {
            initCfg.isLti = true;
        }

        if (typeof DefaultCssUrl !== "undefined") {
            initCfg.cssUrl = DefaultCssUrl;
        }

        // We do this in case it's not cancelled by successfully loaded content,
        // `initialize` will clear the timeout on success
        initCfg.timeoutId = setTimeout(
            function () {
                // eslint-disable-next-line no-alert
                alert("Failed to establish communication between LMSs (client.driver hasn't loaded)");
            },
            30000 // eslint-disable-line no-magic-numbers
        );

        if (typeof PreLaunchConfigurationURL !== "undefined" && PreLaunchConfigurationURL !== "") {
            // Fix links to be SSL when launching in SSL
            if (initCfg.currentLocation.protocol === "https:") {
                PreLaunchConfigurationURL = PreLaunchConfigurationURL.replace("http:", "https:");
            }
            else {
                PreLaunchConfigurationURL = PreLaunchConfigurationURL.replace("https:", "http:");
            }

            initializeWithPrelaunch(PreLaunchConfigurationURL, initCfg);
            return;
        }

        initialize(initCfg);
    };
}());