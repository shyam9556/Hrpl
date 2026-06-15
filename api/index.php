<?php
// Disable execution time limit
set_time_limit(0);

// Target backend base URL
$backend_base = "https://hrpl-production.up.railway.app/api";

// Get request path
$request_uri = $_SERVER['REQUEST_URI']; // e.g. /api/auth/login
$path = preg_replace('/^\/api/', '', $request_uri);
$target_url = $backend_base . $path;

// Get method, headers and body
$method = $_SERVER['REQUEST_METHOD'];
$body = file_get_contents('php://input');

// Helper to get all headers
if (!function_exists('getallheaders')) {
    function getallheaders() {
        $headers = [];
        foreach ($_SERVER as $name => $value) {
            if (substr($name, 0, 5) == 'HTTP_') {
                $headers[str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))))] = $value;
            } elseif ($name == 'CONTENT_TYPE') {
                $headers['Content-Type'] = $value;
            } elseif ($name == 'CONTENT_LENGTH') {
                $headers['Content-Length'] = $value;
            }
        }
        return $headers;
    }
}

// Build headers
$headers = [];
foreach (getallheaders() as $key => $value) {
    if (strtolower($key) === 'host') continue;
    $headers[] = "$key: $value";
}

// Check if this is an SSE request
$is_sse = (strpos($path, '/events') !== false);

// Initialize cURL
$ch = curl_init($target_url);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

if ($body) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

if ($is_sse) {
    // For SSE, we write data as it comes in
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, false); // Do not return raw string
    curl_setopt($ch, CURLOPT_HEADER, false);         // Do not include headers in body callback
    
    // We send headers beforehand
    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    header('Connection: keep-alive');
    header('X-Accel-Buffering: no'); // Disable buffering on Nginx proxies
    
    // Turn off PHP output buffering
    if (function_exists('apache_setenv')) {
        @apache_setenv('no-gzip', 1);
    }
    @ini_set('zlib.output_compression', 0);
    @ini_set('implicit_flush', 1);
    @ob_end_clean();
    @set_time_limit(0);
    
    // Callback to flush data immediately
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) {
        echo $data;
        @ob_flush();
        flush();
        return strlen($data);
    });
    
    curl_exec($ch);
    curl_close($ch);
    exit;
}

// Standard HTTP request/response
$response = curl_exec($ch);

if ($response === false) {
    http_response_code(502);
    echo "Gateway Error: " . curl_error($ch);
    exit;
}

$header_size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

// Split headers and body
$response_headers_text = substr($response, 0, $header_size);
$response_body = substr($response, $header_size);

// Send response headers (filtering out headers that cause the browser to force HTTPS)
$header_lines = explode("\r\n", $response_headers_text);
foreach ($header_lines as $line) {
    if (empty($line)) continue;
    if (stripos($line, 'Transfer-Encoding:') === 0) continue;
    if (stripos($line, 'Strict-Transport-Security:') === 0) continue;
    if (stripos($line, 'Content-Security-Policy:') === 0) continue;
    header($line);
}

echo $response_body;
