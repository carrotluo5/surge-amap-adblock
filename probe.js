var h = {};
try { var s = $response.headers || {}; for (var k in s) { h[k] = s[k]; } } catch (e) {}
h["X-Probe"] = "1";
$done({ headers: h });
