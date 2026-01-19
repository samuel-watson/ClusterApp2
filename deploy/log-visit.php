<?php

error_reporting(E_ALL);
ini_set('display_errors', 1);

// log-visit.php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Only accept POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

// Get the data
$input = json_decode(file_get_contents('php://input'), true);

// Build log entry
$logEntry = [
    'timestamp' => date('Y-m-d H:i:s'),
    'ip' => $input['ip'] ?? $_SERVER['REMOTE_ADDR'],
    'country' => $input['country_name'] ?? 'Unknown',
    'city' => $input['city'] ?? 'Unknown',
    'region' => $input['region'] ?? 'Unknown',
    'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown',
    'referrer' => $_SERVER['HTTP_REFERER'] ?? 'Direct'
];

// Replace the file_put_contents line with:
$logFile = __DIR__ . '/visitors.log';
$result = file_put_contents($logFile, json_encode($logEntry) . "\n", FILE_APPEND | LOCK_EX);


// Change the response to include debug info:
echo json_encode([
    'status' => 'ok',
    'debug' => [
        'logFile' => $logFile,
        'writeResult' => $result,
        'dirWritable' => is_writable(__DIR__),
        'fileExists' => file_exists($logFile),
        'fileWritable' => is_writable($logFile)
    ]
]);
?>