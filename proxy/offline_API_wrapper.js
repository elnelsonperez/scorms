var API = {
	LMSInitialize: function() {
		console.info("[Third Party LMS] LMSInitialize called")
		this.data = {};
		this.data["cmi.core.lesson_status"] = "not attempted";
		this.data["cmi.suspend_data"] = "";
		return "true";
	},
	LMSFinish: function() {
		console.info("[Third Party LMS] LMSFinish called")
		return "true";
	},
	LMSGetValue: function(key) {
		console.info('[Third Party LMS] LMSGetValue("' + key + '")', this.data[key]);
		return this.data[key];
	},
	LMSSetValue: function(key, value) {
		 console.info('[Third Party LMS] LMSSetValue("' + key + '")', value );
		this.data[key] = value;
		return "true";
	},
	LMSCommit: function() {
		console.log("[Third Party LMS] LMSCommit called")
		return "true";
	},
	LMSGetLastError: function() {
		console.log("[Third Party LMS] LMSGetLastError called")
		return 0;
	},
	LMSGetErrorString: function() {
		console.log("[Third Party LMS] LMSGetErrorString called")
		return "Fake error string.";
	},
	LMSGetDiagnostic: function() {
		console.log("[Third Party LMS] LMSGetDiagnostic called")
		return "Fake diagnostic information."
	}
}
