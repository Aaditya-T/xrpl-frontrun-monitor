/**
 * @typedef {Object} TradeEvent
 * @property {string} txHash
 * @property {string} pair
 * @property {number} rate
 * @property {number} volumeBase
 * @property {number} volumeQuote
 * @property {string} buyer
 * @property {string} seller
 * @property {string} taker
 * @property {string} provider
 * @property {boolean} isAmm
 * @property {number} ledgerIndex
 * @property {number} txIndex
 * @property {string} ledgerCloseTimeUtc
 * @property {string=} txType
 * @property {number=} offerSequence
 * @property {number=} sequence
 * @property {number=} ticketSequence
 */

/**
 * @typedef {"buy_base" | "sell_base" | "unknown"} TradeSide
 */

/**
 * @typedef {TradeEvent & {
 *   side: TradeSide,
 *   sortKey: string,
 *   participantKey: string
 * }} ClassifiedTrade
 */

/**
 * @typedef {Object} SandwichAlert
 * @property {string} type
 * @property {number} confidence
 * @property {string[]} reasons
 * @property {string} pair
 * @property {string} attacker
 * @property {string} victim
 * @property {number} entryRate
 * @property {number} victimRate
 * @property {number} exitRate
 * @property {number} estimatedProfitBps
 * @property {number} ledgerSpan
 * @property {ClassifiedTrade} frontRun
 * @property {ClassifiedTrade} victimTrade
 * @property {ClassifiedTrade} backRun
 */
