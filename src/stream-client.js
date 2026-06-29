import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { normalizeStreamTrade } from "./normalize.js";

export class XrplDataStreamClient extends EventEmitter {
  constructor(options) {
    super();
    this.url = options.url;
    this.apiKey = options.apiKey;
    this.subscription = options.subscription;
    this.reconnectMs = options.reconnectMs ?? 3000;
    this.closedByUser = false;
    this.ws = null;
  }

  connect() {
    if (!this.apiKey) {
      throw new Error("XRPLDATA_API_KEY is required for the live stream.");
    }
    this.closedByUser = false;
    this.ws = new WebSocket(this.url, {
      headers: {
        "x-api-key": this.apiKey
      }
    });

    this.ws.on("open", () => {
      this.emit("open");
      this.ws.send(JSON.stringify(this.subscription));
    });

    this.ws.on("message", (data) => {
      this.handleMessage(data);
    });

    this.ws.on("error", (error) => {
      this.emit("error", error);
    });

    this.ws.on("close", () => {
      this.emit("close");
      if (!this.closedByUser) {
        setTimeout(() => this.connect(), this.reconnectMs);
      }
    });
  }

  close() {
    this.closedByUser = true;
    if (this.ws) this.ws.close();
  }

  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch (error) {
      this.emit("error", error);
      return;
    }

    if (message.code || message.message) {
      this.emit("status", message);
      return;
    }

    const trade = normalizeStreamTrade(message);
    if (trade) this.emit("trade", trade);
  }
}

export function buildTradeSubscription(config) {
  return {
    command: "subscribe",
    stream: "trades",
    base: config.base,
    quote: config.quote,
    type: config.streamType,
    exchange: config.exchange
  };
}
