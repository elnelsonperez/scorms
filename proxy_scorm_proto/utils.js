function include_script(script_filename) {
    var html_doc = document.getElementsByTagName('head').item(0);
    var js = document.createElement('script');
    var now = new Date();
    var buster = now.getYear()+now.getMonth()+now.getDay()+now.getHours();

    js.setAttribute('language', 'javascript');
    js.setAttribute('type', 'text/javascript');
    if (script_filename.indexOf("?") === -1) {
        js.setAttribute('src', script_filename + "?cachebuster=" + buster);
    } else {
        js.setAttribute('src', script_filename);
    }

    html_doc.appendChild(js);
    return false;
}
