from flask import Flask, render_template,request

app = Flask(__name__)




@app.after_request
def set_headers(response):
    response.headers['Content-Security-Policy'] = "default-src 'unsafe-inline' *.ngrok.io localhost:5000;"
    return response


@app.route("/launcher")
def get_launcher_document():
    print(request.args)
    return render_template('launcher.jinja2')
