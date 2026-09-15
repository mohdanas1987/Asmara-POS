/**
 * Hardware abstraction layer -- printers (USB/Bluetooth/WiFi), cash drawer, payment
 * terminals. Barcode scanners deliberately have NO code here: the vast majority of retail/
 * restaurant barcode scanners are HID keyboard-emulation devices -- to the OS and this app
 * they just look like someone typing very fast into whatever input is focused, followed by
 * Enter. No driver, no library, no IPC needed; a focused text input in the frontend already
 * receives scans. (A scanner that ISN'T HID -- a proper serial/Bluetooth-LE scanner -- would
 * need its own module here, but that's uncommon enough to not build blind.)
 *
 * IMPORTANT / HONEST LIMITATION: the native driver packages this depends on (escpos,
 * usb, node-hid, serialport, bluetooth-serial-port) are NOT installed here. They need
 * native compilation (node-gyp) against the actual target machine's OS/architecture, and
 * there is no physical printer, scanner, or terminal attached to this development session to
 * test against. Every require() below is wrapped so a machine missing one of these optional
 * packages doesn't crash the whole app -- it just reports that connection type as
 * unavailable. This file is real, protocol-correct code, not a mock, but it is UNVERIFIED
 * against real hardware. That verification has to happen on a real machine with real
 * peripherals attached -- tracked as the next step once this reaches that stage.
 */

function tryRequire(name) {
    try {
        return require(name);
    } catch {
        return null;
    }
}

const escpos = tryRequire('escpos');
const escposUSB = tryRequire('escpos-usb');
const escposNetwork = tryRequire('escpos-network');
const escposBluetooth = tryRequire('escpos-bluetooth');

async function listPrinters() {
    const found = [];

    if (escpos && escposUSB) {
        try {
            const usbDevices = escposUSB.findPrinter();
            usbDevices.forEach((d, i) => found.push({ id: `usb-${i}`, type: 'usb', label: d.deviceDescriptor ? `USB printer ${i + 1}` : 'USB printer' }));
        } catch (err) {
            console.warn('[hardware] USB printer discovery unavailable:', err.message);
        }
    }

    // Bluetooth and network printers are usually pre-configured by IP/address rather than
    // "discovered" the way USB is -- real discovery for these needs the config wizard step
    // where the user enters (or scans for) the device's address, not a blind scan here.

    if (!escpos) {
        found.push({
            id: 'unavailable',
            type: 'info',
            label: 'Printer drivers not installed on this machine yet -- see hardware.js notes.',
        });
    }

    return found;
}

async function print({ printerId, type, address, escposCommands }) {
    if (!escpos) {
        throw new Error('escpos is not installed on this machine. Install it (and the matching escpos-usb/escpos-network/escpos-bluetooth adapter) to enable printing.');
    }

    let device;
    if (type === 'usb' && escposUSB) {
        device = new escposUSB();
    } else if (type === 'network' && escposNetwork) {
        device = new escposNetwork(address);
    } else if (type === 'bluetooth' && escposBluetooth) {
        device = new escposBluetooth(address);
    } else {
        throw new Error(`Unsupported or unavailable printer type: ${type}`);
    }

    const printer = new escpos.Printer(device);
    return new Promise((resolve, reject) => {
        device.open((err) => {
            if (err) return reject(err);
            escposCommands(printer); // caller builds the actual ticket layout
            printer.cut().close(resolve);
        });
    });
}

async function openCashDrawer(printerId) {
    // ESC/POS cash drawers are kicked through the printer they're wired to (pin 2 or 5),
    // not addressed independently -- same device, same connection this module already has.
    return print({
        printerId,
        type: 'usb',
        escposCommands: (printer) => printer.cashdraw(2),
    });
}

async function listPaymentTerminals() {
    // No specific provider chosen yet (Stripe Terminal, Adyen, SumUp, etc. all have
    // meaningfully different local-discovery and pairing flows) -- real integration needs
    // that product decision first. Returns an empty, honest list rather than fabricating
    // terminals that don't exist.
    return [];
}

module.exports = { listPrinters, print, openCashDrawer, listPaymentTerminals };
