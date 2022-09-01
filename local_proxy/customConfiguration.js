/* eslint-disable new-cap */

(function () {
    let xhr,
        customConfig;

    var dispatchCustomConfigUrl = "https://cloud.scorm.com/api/cloud/dispatch/f8d9c8c9-43e7-40aa-854e-d204c7f55cec/customConfig?appId=LF3KEPVIMW";

    function addCustomConfigOptions(customConfig) {
        let key,
            configValueScript,
            html_doc = document.getElementsByTagName('head').item(0),
            js = document.createElement('script');

        js.setAttribute('language', 'javascript');
        js.setAttribute('type', 'text/javascript');

        for (key in customConfig) {
            if (customConfig.hasOwnProperty(key)) {
                configValueScript = document.createTextNode(key + "='" + customConfig[key] + "';");
                js.appendChild(configValueScript);
            }
        }

        html_doc.appendChild(js);

        if (customConfig.hasOwnProperty('DispatchClientLoaderFilename') && customConfig.DispatchClientLoaderFilename) {
            include_script(DispatchRoot + customConfig.DispatchClientLoaderFilename);
        } else {
            include_script("dispatch.client.loader.v2.js");
        }
    }

    //Fix custom config URL protocol to match the window's
    if (window.location.protocol === "https:") {
        dispatchCustomConfigUrl = dispatchCustomConfigUrl.replace('http:', 'https:');
    } else {
        dispatchCustomConfigUrl = dispatchCustomConfigUrl.replace('https:', 'http:');
    }

    xhr = new XMLHttpRequest();
    xhr.open("GET", dispatchCustomConfigUrl, true);
    xhr.setRequestHeader("launchtoken", "3UH5aDSPJcPQUmCqrAeokzDiyfM9O23ai4wigjxL");
    xhr.onreadystatechange = function () {
        // eslint-disable-next-line no-magic-numbers
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                try {
                    customConfig = JSON.parse(xhr.responseText);
                }
                catch (ex) {
                    // eslint-disable-next-line no-alert
                    alert("Failed to parse response from custom configuration URL as JSON, the launch has been halted. (" + ex + ")");
                    return;
                }

                addCustomConfigOptions(customConfig);

                return;
            }
            else if (xhr.status === 404) {
                // A 404 means that no custom configuration is set, so just continue on with the launch as normal
                include_script("dispatch.client.loader.v2.js");
                return;
            }

            // eslint-disable-next-line no-alert
            alert("Unrecognized HTTP status returned from custom configuration URL (" + xhr.status + "), the launch has been halted.");
        }
    };

    try {
        xhr.send();
    }
    catch (ex) {
        // research indicates that IE is known to just throw exceptions
        // on .send and it seems everyone just ignores them
    }
}());
