var TOPIC = "https://ntfy.sh/surgewx1793712907";
var url = "";
try { url = String($request && $request.url); } catch (e) { url = "ERR"; }
var host = url.split("/")[2] || "?";
$httpClient.post({ url: TOPIC, body: "HIT|" + host + "|" + url.slice(0, 200) }, function () { $done({}); });
