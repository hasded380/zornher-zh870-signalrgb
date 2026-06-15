export function Name() { return "ZORNHER ZH870"; }
export function Version() { return "1.2.1"; }
export function VendorId() { return 0x05AC; }
export function ProductId() { return 0x024F; }
export function Publisher() { return "ZORNHER"; }
export function Documentation(){ return "troubleshooting/sonix"; }
export function Size() { return [17, 6]; }
export function DeviceType(){return "keyboard";}
export function Validate(endpoint) {
	return endpoint.usage_page === 0xFF13 && endpoint.usage === 0x0001 &&
		(endpoint.interface === 2 || endpoint.interface === 3);
}
export function ImageUrl() { return "https://i.ibb.co/xqYcZs9j/zh870-connected.png"; }
export function ConflictingProcesses() { return ["DeviceDriver.exe"]; }

const USB_LIGHTING_PARAMS = [
	{property:"shutdownColor", group:"lighting", label:"Shutdown Color", description: "This color is applied to the device when the System, or SignalRGB is shutting down", min:"0", max:"360", type:"color", default:"#000000"},
	{property:"LightingMode", group:"lighting", label:"Lighting Mode", description: "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color", type:"combobox", values:["Canvas", "Forced"], default:"Canvas"},
	{property:"forcedColor", group:"lighting", label:"Forced Color", description: "The color used when 'Forced' Lighting Mode is enabled", min:"0", max:"360", type:"color", default:"#009bde"},
];

const WIRELESS_LIGHTING_PARAMS = [
	{
		property: "wirelessRgbNotice",
		group: "lighting",
		label: "2.4G Receiver",
		description: "Per-key RGB from SignalRGB is not supported over the wireless dongle. Connect the keyboard with a USB cable (ZH870 Gaming Keyboard).",
		type: "textfield",
		default: "Lighting control unavailable over 2.4G — use USB connection.",
	},
];

/* global
wirelessRgbNotice:readonly
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
*/
export function ControllableParameters(){
	const productName = getCurrentProductName();
	if (isWirelessZH870(productName)) {
		return WIRELESS_LIGHTING_PARAMS;
	}
	return USB_LIGHTING_PARAMS;
}

export function Initialize() {
	getProtocol().Initialize();
}

export function Render() {
	getProtocol().render();
}

export function Shutdown(SystemSuspending) {
	getProtocol().shutdown(SystemSuspending);
}

export class ZH870_Device_Protocol {
	constructor() {
		this.Config = {
			DeviceProductID: 0x024F,
			DeviceNameUSB: "ZORNHER ZH870 USB",
			DeviceName2_4G: "ZORNHER ZH870 2.4G",
			DeviceEndpoint: [
				{ "interface": 2, "usage": 0x0001, "usage_page": 0xFF13, "collection": 0x0000 },
			],
			LedNames: ZH870_LAYOUT.vLedNames,
			LedPositions: ZH870_LAYOUT.vLedPositions,
			Leds: ZH870_LAYOUT.vLeds,
		};
		this.rgbReady = false;
		this.maxLedIndex = 121;
		this.rgbBuffer = new Array((this.maxLedIndex + 1) * 4).fill(0);
		this.compactBuffer = new Array(ZH870_LAYOUT.vLeds.length * 4);
		this.hidPacket = new Array(65).fill(0);
		this.lastSent = null;
		this.startCmd = new Array(10).fill(0);

		// compactPayload: packed [id,R,G,B]×104 → 416 bytes / 7 chunks (0x07).
		// Stable on ZH870 (~21 FPS vs ~20 sparse).
		this.compactPayload = true;

		// All frame delays in one place (ms). Tweak them if you see artifacts.
		// afterStartCmd / afterStartAck protect the first LEDs (F1–F12, incl. F3):
		// if the first keys start glitching — increase these two values.
		// betweenChunks: set back to 1 if the middle/end of the frame falls apart.
		// frameEnd: if 1, it's an artificial cap ~30 FPS
		this.timing = {
			afterStartCmd: 1,
			afterStartAck: 1,
			betweenChunks: 1,
			afterZero: 0,
			afterCommit: 1,
			frameEnd: 0,
		};
	}

	buildRgbData(deviceLedPositions, deviceLeds, overrideColor) {
		if (this.compactPayload) {
			return this.buildCompactRgbData(deviceLedPositions, deviceLeds, overrideColor);
		}
		return this.buildSparseRgbData(deviceLedPositions, deviceLeds, overrideColor);
	}

	buildSparseRgbData(deviceLedPositions, deviceLeds, overrideColor) {
		const RGBData = this.rgbBuffer.fill(0);
		let fixedColor = null;

		if (overrideColor) {
			fixedColor = hexToRgb(overrideColor);
		} else if (LightingMode === "Forced") {
			fixedColor = hexToRgb(forcedColor);
		}

		for (let iIdx = 0; iIdx < deviceLeds.length; iIdx++) {
			const ledId = deviceLeds[iIdx];
			const offset = ledId * 4;
			const color = fixedColor ?? device.color(deviceLedPositions[iIdx][0], deviceLedPositions[iIdx][1]);

			RGBData[offset]     = ledId;
			RGBData[offset + 1] = color[0];
			RGBData[offset + 2] = color[1];
			RGBData[offset + 3] = color[2];
		}

		return RGBData;
	}

	buildCompactRgbData(deviceLedPositions, deviceLeds, overrideColor) {
		const RGBData = this.compactBuffer;
		let fixedColor = null;
		let writeIdx = 0;

		if (overrideColor) {
			fixedColor = hexToRgb(overrideColor);
		} else if (LightingMode === "Forced") {
			fixedColor = hexToRgb(forcedColor);
		}

		for (let iIdx = 0; iIdx < deviceLeds.length; iIdx++) {
			const ledId = deviceLeds[iIdx];
			const color = fixedColor ?? device.color(deviceLedPositions[iIdx][0], deviceLedPositions[iIdx][1]);

			RGBData[writeIdx++] = ledId;
			RGBData[writeIdx++] = color[0];
			RGBData[writeIdx++] = color[1];
			RGBData[writeIdx++] = color[2];
		}

		return RGBData;
	}

	getPayloadLength() {
		if (this.compactPayload) {
			return this.getLeds().length * 4;
		}
		return (this.maxLedIndex + 1) * 4;
	}

	sendHidPacket(dataBytes, offset, length) {
		const packet = this.hidPacket;
		packet[0] = 0x00;

		for (let i = 0; i < length; i++) {
			packet[i + 1] = dataBytes[offset + i];
		}
		for (let i = length + 1; i < 65; i++) {
			packet[i] = 0;
		}

		device.send_report(packet, 65);
	}

	isUsbKeyboard() {
		const productName = getCurrentProductName();
		return isZH870USBProduct(productName) && !isWirelessZH870(productName);
	}

	render() {
		if (!this.isUsbKeyboard() || !this.rgbReady) {
			return;
		}
		this.sendColors();
	}

	shutdown(SystemSuspending) {
		if (!this.isUsbKeyboard() || !this.rgbReady) {
			return;
		}
		const color = SystemSuspending ? "#000000" : shutdownColor;
		this.sendColors(color);
	}

	Initialize() {
		this.rgbReady = false;
		this.maxLedIndex = Math.max(...this.Config.Leds);
		this.rgbBuffer = new Array((this.maxLedIndex + 1) * 4).fill(0);
		this.compactBuffer = new Array(this.Config.Leds.length * 4);
		this.lastSent = null;

		const productName = getCurrentProductName();
		device.log(`HID product: ${productName}`);

		device.setImageFromUrl("https://i.ibb.co/xqYcZs9j/zh870-connected.png");

		if (isWirelessZH870(productName)) {
			device.setName(this.Config.DeviceName2_4G);
			device.setSize([1, 1]);
			device.setControllableLeds([], []);
			device.log(`2.4G dongle (${productName}): lighting disabled.`);
			return;
		}

		if (!isZH870USBProduct(productName)) {
			device.setName(`Unsupported (${productName})`);
			device.setSize([1, 1]);
			device.setControllableLeds([], []);
			device.log("RGB disabled: HID product name is not ZH870 USB.");
			return;
		}

		device.setName(this.Config.DeviceNameUSB);
		device.setSize(ZH870_LAYOUT.size);
		device.setControllableLeds(this.Config.LedNames, this.Config.LedPositions);
		device.log(`RGB payload: compact 416B / 7 chunks`);
		this.detectDeviceEndpoint();
	}

	getLedNames() { return this.Config.LedNames; }
	getLedPositions() { return this.Config.LedPositions; }
	getLeds() { return this.Config.Leds; }

	sendColors(overrideColor) {
		if (!this.isUsbKeyboard() || !this.rgbReady || this.getLeds().length === 0) {
			return;
		}

		const RGBData = this.buildRgbData(this.getLedPositions(), this.getLeds(), overrideColor);

		const force = overrideColor !== undefined;
		const leds = this.getLeds();
		if (!force && this.isSameAsLast(RGBData, leds)) {
			return;
		}

		this.writeRGBPackage(RGBData);
		this.storeLast(RGBData, leds);
	}

	isSameAsLast(data, leds) {
		const last = this.lastSent;
		if (!last) {
			return false;
		}

		if (this.compactPayload) {
			const payloadLength = leds.length * 4;
			for (let i = 0; i < payloadLength; i++) {
				if (last[i] !== data[i]) {
					return false;
				}
			}
			return true;
		}

		for (let iIdx = 0; iIdx < leds.length; iIdx++) {
			const offset = leds[iIdx] * 4;
			if (
				last[offset]     !== data[offset]     ||
				last[offset + 1] !== data[offset + 1] ||
				last[offset + 2] !== data[offset + 2] ||
				last[offset + 3] !== data[offset + 3]
			) {
				return false;
			}
		}
		return true;
	}

	storeLast(data, leds) {
		if (this.compactPayload) {
			const payloadLength = leds.length * 4;
			if (!this.lastSent || this.lastSent.length !== payloadLength) {
				this.lastSent = new Array(payloadLength);
			}
			for (let i = 0; i < payloadLength; i++) {
				this.lastSent[i] = data[i];
			}
			return;
		}

		if (!this.lastSent || this.lastSent.length !== data.length) {
			this.lastSent = new Array(data.length);
		}
		for (let iIdx = 0; iIdx < leds.length; iIdx++) {
			const offset = leds[iIdx] * 4;
			this.lastSent[offset]     = data[offset];
			this.lastSent[offset + 1] = data[offset + 1];
			this.lastSent[offset + 2] = data[offset + 2];
			this.lastSent[offset + 3] = data[offset + 3];
		}
	}

	pauseIf(ms) {
		if (ms > 0) {
			device.pause(ms);
		}
	}

	buildStartCmd(chunkCount) {
		const cmd = this.startCmd;
		cmd[0] = 0x00;
		cmd[1] = 0x04;
		cmd[2] = 0x20;
		cmd[3] = 0x00;
		cmd[4] = 0x00;
		cmd[5] = 0x00;
		cmd[6] = 0x00;
		cmd[7] = 0x00;
		cmd[8] = 0x00;
		cmd[9] = chunkCount;
		return cmd;
	}

	writeRGBPackage(data){
		const payloadLength = this.getPayloadLength();
		const chunkCount = Math.ceil(payloadLength / 64);
		const t = this.timing;

		device.flush();
		device.send_report(this.buildStartCmd(chunkCount), 65);
		this.pauseIf(t.afterStartCmd);
		device.get_report([0x00], 65);
		this.pauseIf(t.afterStartAck);

		for (let offset = 0; offset < payloadLength; offset += 64) {
			this.sendHidPacket(data, offset, Math.min(64, payloadLength - offset));
			this.pauseIf(t.betweenChunks);
		}

		device.send_report([0x00], 65);
		this.pauseIf(t.afterZero);
		device.send_report([0x00, 0x04, 0x02], 65);
		this.pauseIf(t.afterCommit);
		device.get_report([0x00], 65);
		this.pauseIf(t.frameEnd);
	}

	detectDeviceEndpoint() {
		if (!this.isUsbKeyboard()) {
			return;
		}

		console.log("Searching for endpoints...");
		this.rgbReady = false;

		const deviceEndpoints = device.getHidEndpoints();
		const expectedEndpoints = this.Config.DeviceEndpoint;

		for (let endpoints = 0; endpoints < expectedEndpoints.length; endpoints++) {
			const endpoint = expectedEndpoints[endpoints];

			for (let endpointList = 0; endpointList < deviceEndpoints.length; endpointList++) {
				const currentEndpoint = deviceEndpoints[endpointList];

				if (
					endpoint.interface	=== currentEndpoint.interface	&&
					endpoint.usage		=== currentEndpoint.usage		&&
					endpoint.usage_page	=== currentEndpoint.usage_page	&&
					endpoint.collection	=== currentEndpoint.collection	) {

					device.set_endpoint(
						currentEndpoint.interface,
						currentEndpoint.usage,
						currentEndpoint.usage_page,
						currentEndpoint.collection,
					);

					console.log("Endpoint " + JSON.stringify(currentEndpoint) + " found!");
					device.log("RGB endpoint set: " + JSON.stringify(currentEndpoint));
					this.rgbReady = true;
					return;
				}
			}
		}

		console.log(`Endpoints not found in the device! - ${JSON.stringify(expectedEndpoints)}`);
		device.notify("RGB endpoint missing", "SignalRGB could not find the RGB HID endpoint. Check the device console for endpoint list.", 2);
	}
}

const ZH870_LAYOUT = {
	vLedNames: [
		"Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "F13", "Prtsc", "ScrLk", "Pause",
		"`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Insert", "Home", "PgUp",
		"Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Delete", "End", "PgDn",
		"CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter",
		"Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow",
		"Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "APP", "Right Ctrl", "Left Arrow", "Down Arrow", "Right Arrow",
	],
	vLeds: [
		1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 112, 113, 115,
		19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 103, 116, 117, 118,
		37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 67, 119, 120, 121,
		55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 85,
		73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 101,
		91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 102,
	],
	vLedPositions: [
		[0,0], [1,0], [2,0], [3,0], [4,0], [5,0], [6,0], [7,0], [8,0], [9,0], [10,0], [11,0], [12,0], [13,0], [14,0], [15,0], [16,0],
		[0,1], [1,1], [2,1], [3,1], [4,1], [5,1], [6,1], [7,1], [8,1], [9,1], [10,1], [11,1], [12,1], [13,1], [14,1], [15,1], [16,1],
		[0,2], [1,2], [2,2], [3,2], [4,2], [5,2], [6,2], [7,2], [8,2], [9,2], [10,2], [11,2], [12,2], [13,2], [14,2], [15,2], [16,2],
		[0,3], [1,3], [2,3], [3,3], [4,3], [5,3], [6,3], [7,3], [8,3], [9,3], [10,3], [11,3], [13,3],
		[0,4], [2,4], [3,4], [4,4], [5,4], [6,4], [7,4], [8,4], [9,4], [10,4], [11,4], [13,4], [15,4],
		[0,5], [1,5], [2,5], [6,5], [10,5], [11,5], [12,5], [13,5], [14,5], [15,5], [16,5]
	],
	size: [17, 6],
};

const protocolByDevice = new Map();

function getDeviceKey() {
	const info = device.getDeviceInfo();
	return info?.path ?? info?.product ?? "unknown";
}

function getProtocol() {
	const key = getDeviceKey();
	if (!protocolByDevice.has(key)) {
		protocolByDevice.set(key, new ZH870_Device_Protocol());
	}
	return protocolByDevice.get(key);
}

function getCurrentProductName() {
	return device.getDeviceInfo()?.product ?? "";
}

function isZH870USBProduct(productName) {
	const name = productName.toUpperCase();
	return name.includes("ZH870") && name.includes("GAMING");
}

function isWirelessZH870(productName) {
	const name = productName.toUpperCase();
	return name.includes("ZH870") && (
		name.includes("2.4G") ||
		name.includes("WIRELESS") ||
		name.includes("RECEIVER")
	);
}

function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	const colors = [];
	colors[0] = parseInt(result[1], 16);
	colors[1] = parseInt(result[2], 16);
	colors[2] = parseInt(result[3], 16);

	return colors;
}
