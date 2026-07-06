import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

describe('local device discovery', () => {
  it('uses zero-configuration CNC defaults and MAC-derived identity', () => {
    expect(source).toContain('kDefaultDeviceHostname = "cnc"');
    expect(source).toContain('kDefaultDeviceFriendlyName = "ESP32 CNC"');
    expect(source).toContain('ESP.getEfuseMac()');
    expect(source).toContain('"%06llX"');
    expect(source).toContain('"esp32-cnc-" + deviceId');
  });

  it('loads preferred and fallback SD paths before NVS', () => {
    expect(source).toContain('kPrimaryDeviceConfigPath = "/esp32-cnc/config.json"');
    expect(source).toContain('kFallbackDeviceConfigPath = "/config.json"');
    const loader = source.slice(source.indexOf('void loadDeviceIdentity()'), source.indexOf('float clampFloat'));
    expect(loader.indexOf('readDeviceConfigFile')).toBeLessThan(loader.indexOf('devicePrefs.getString'));
    expect(loader).toContain('saveDeviceIdentityToNvs();');
    expect(loader).toContain('deviceIdentity.source = "nvs"');
  });

  it('bounds and strictly parses the minimal SD JSON document', () => {
    expect(source).toContain('kMaxDeviceConfigBytes = 4096');
    expect(source).toContain('parseDeviceConfigJson(json, hostname, friendlyName, bluetoothEnabled,');
    expect(source).toContain('hostnameFound && friendlyNameFound');
    expect(source).toContain('index == json.length()');
  });

  it('normalizes hostnames as DNS labels and strips a local suffix', () => {
    const sanitizer = source.slice(source.indexOf('String sanitizeDeviceHostname'), source.indexOf('bool readDeviceConfigFile'));
    expect(sanitizer).toContain('hostname.trim()');
    expect(sanitizer).toContain('hostname.toLowerCase()');
    expect(sanitizer).toContain('hostname.endsWith(".local")');
    expect(sanitizer).toContain('sanitized.length() < 63');
    expect(sanitizer).toContain('safeDeviceHostnameFallback(deviceId)');
  });

  it('advertises HTTP and CNC services and exposes only public identity', () => {
    expect(source).toContain('MDNS.begin(deviceIdentity.hostname.c_str())');
    expect(source).toContain('MDNS.addService("http", "tcp", 80)');
    expect(source).toContain('MDNS.addService("esp32cnc", "tcp", 80)');
    expect(source).toContain('server.on("/api/device", HTTP_GET, handleDeviceInfo)');
    const response = source.slice(source.indexOf('String deviceInfoJson()'), source.indexOf('void handleDeviceInfo()'));
    expect(response).toContain('\\"deviceId\\"');
    expect(response).toContain('\\"localUrl\\"');
    expect(response).toContain('\\"mdnsEnabled\\"');
    expect(response).not.toContain('pass');
    expect(response).not.toContain('password');
  });

  it('keeps BLE optional, bounded, and lower priority than the web control path', () => {
    expect(source).toContain('#define ESP32CNC_ENABLE_BLE 1');
    expect(source).toContain('kMaxBleAdvertisementNameBytes = 26');
    expect(source).toContain('const String localName = "CNC " + deviceIdentity.hostname + ".local"');
    expect(source).toContain('const String apName = "CNC " + currentIpAddress()');
    expect(source).toContain('return "CNC-" + deviceIdentity.deviceId');
    expect(source).toContain('ESP.getFreeHeap() < 70000');
    expect(source).toContain('NimBLEDevice::init');
    expect(source).toContain('BLE_GAP_CONN_MODE_NON');
    expect(source).toContain('deviceIdentity.bluetoothStarted = advertising->start()');
    expect(source.indexOf('startHttpServer();')).toBeLessThan(source.indexOf('startBluetoothAdvertisement();', source.indexOf('void setup()')));
  });

  it('defaults BLE config on and persists explicit SD flags to NVS', () => {
    expect(source).toContain('bool bluetoothEnabled = true');
    expect(source).toContain('bool bluetoothAdvertiseName = true');
    expect(source).toContain('key == "bluetooth"');
    expect(source).toContain('key == "enabled"');
    expect(source).toContain('key == "advertiseName"');
    expect(source).toContain('devicePrefs.putBool(kDevicePrefsBleEnabledKey');
    expect(source).toContain('devicePrefs.putBool(kDevicePrefsBleNameKey');
  });

  it('persists identity updates to NVS before optional SD config and requires restart', () => {
    expect(source).toContain('server.on("/api/device", HTTP_PATCH, handleDeviceUpdate)');
    const update = source.slice(source.indexOf('void handleDeviceUpdate()'), source.indexOf('void handleSystemRestart()'));
    expect(update).toContain('jobIsActive()');
    expect(update.indexOf('saveDeviceIdentityToNvs(hostname, friendlyName)')).toBeLessThan(update.indexOf('writeDeviceConfigToSd(hostname, friendlyName'));
    expect(update).toContain('\\"requiresRestart\\"');
    expect(update).toContain('pendingBluetoothName(hostname)');
    const writer = source.slice(source.indexOf('bool writeDeviceConfigToSd'), source.indexOf('void loadDeviceIdentity()'));
    expect(writer).toContain('/esp32-cnc/config.tmp');
    expect(writer).toContain('/esp32-cnc/config.bak');
    expect(writer).toContain('identity was saved to NVS only');
  });

  it('allows restart only when all machine control paths are idle', () => {
    expect(source).toContain('server.on("/api/system/restart", HTTP_POST, handleSystemRestart)');
    const restart = source.slice(source.indexOf('void handleSystemRestart()'), source.indexOf('void handleHealth()'));
    expect(restart).toMatch(/jobIsActive\(\)[\s\S]*jobWaitingForOk[\s\S]*jogIsActive\(\)[\s\S]*otaActive[\s\S]*priorityCommandCount/);
    expect(restart).toContain('rebootAtMs = millis() + 1000');
  });
});
