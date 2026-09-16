'use client';

// Typed wrapper around the bridge preload.js exposes (window.restaurantOS). Undefined when
// this app is opened in a plain browser (dev preview, or the PWA/web-only deployment mode) --
// every caller must handle that, not assume Electron is present.
export interface PrinterInfo {
  id: string;
  type: 'usb' | 'network' | 'bluetooth' | 'info';
  label: string;
}

// Mirrors hardware.js's `runTicket()` on the Electron main-process side. A plain,
// JSON-serializable instruction list -- Electron IPC (structured clone) cannot carry a
// function across the renderer/main boundary, so the actual ticket LAYOUT has to be data,
// not code, built here and interpreted there.
export type PrintInstruction =
  | { op: 'align'; value: 'lt' | 'ct' | 'rt' }
  | { op: 'style'; bold?: boolean; size?: [number, number] }
  | { op: 'text'; value: string }
  | { op: 'feed'; lines?: number }
  | { op: 'rule' }
  | { op: 'qrcode'; value: string }
  | { op: 'cashdraw' };

export interface PrintJob {
  printerId: string;
  type: 'usb' | 'network' | 'bluetooth';
  address?: string;
  ticket: PrintInstruction[];
}

export interface SerialPortInfo {
  id: string;
  path?: string;
  manufacturer?: string | null;
  serialNumber?: string | null;
  type?: 'info';
  label?: string;
}

export type ScaleTransport = 'serial' | 'network';

export interface ScaleConnectConfig {
  transport: ScaleTransport;
  port?: string; // serial: the COM/tty path
  baudRate?: number; // serial
  host?: string; // network
  tcpPort?: number; // network
}

export interface ScaleReading {
  weight: number;
  unit: 'kg' | 'g' | 'lb';
  stable: boolean | null;
}

export interface ScaleConnectResult {
  status: 'connected';
  transport: ScaleTransport;
  port?: string;
  baudRate?: number;
  host?: string;
  tcpPort?: number;
}

export interface NetworkScaleCandidate {
  host: string;
  port: number;
  sample: ScaleReading;
}

interface RestaurantOSBridge {
  listPrinters: () => Promise<PrinterInfo[]>;
  print: (payload: PrintJob) => Promise<void>;
  openCashDrawer: (printerId: string) => Promise<void>;
  listPaymentTerminals: () => Promise<unknown[]>;
  getConfig: (key: string) => Promise<unknown>;
  setConfig: (key: string, value: unknown) => Promise<void>;

  // Weighing scale bridge
  listScales: () => Promise<SerialPortInfo[]>;
  autoDetectScale: (options?: { listenMs?: number }) => Promise<{ transport: 'serial'; port: string; baudRate: number; sample: ScaleReading } | null>;
  discoverNetworkScales: (subnetBase: string, options?: { ports?: number[]; timeoutMs?: number }) => Promise<NetworkScaleCandidate[]>;
  connectScale: (config: ScaleConnectConfig) => Promise<ScaleConnectResult>;
  disconnectScale: () => Promise<void>;
  getScaleReading: () => Promise<ScaleReading | null>;
  isScaleConnected: () => Promise<boolean>;
  onScaleWeight: (callback: (reading: ScaleReading) => void) => () => void;
  onScaleError: (callback: (err: { message: string }) => void) => () => void;
}

declare global {
  interface Window {
    restaurantOS?: RestaurantOSBridge;
  }
}

export function getDesktopBridge(): RestaurantOSBridge | null {
  if (typeof window === 'undefined') return null;
  return window.restaurantOS ?? null;
}
