const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const moment = require('moment-timezone');

const ALPACA_API_KEY = process.env.ALPACA_API_KEY_V6;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY_V6;
const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_BASE_URL = 'https://data.alpaca.markets/v2/stocks';
const PREDICTION_LOG_FILE = 'predictions_log.json';
const QUANTITY_MIN = 25;
const QUANTITY_MAX = 100;

const stockSymbols = ['NIO', 'FUBO', 'OPEN', 'SPCE', 'NKLA', 'BB', 'AMC', 'IQ', 'STNE', 'PAGS'];

// Function to check if the current time is between 9:30 AM and 4:00 PM EST
function isTimeBetween930And4() {
    const now = moment().tz("America/New_York");
    const startTime = moment.tz("09:30 AM", "hh:mm A", "America/New_York");
    const endTime = moment.tz("04:00 PM", "hh:mm A", "America/New_York");
    return now.isBetween(startTime, endTime, null, "[)");
}

// Fetch intraday stock data
async function fetchIntradayData(symbol, startDate) {
    const endpoint = `${DATA_BASE_URL}/${symbol}/bars`;
    try {
        const response = await axios.get(endpoint, {
            headers: {
                'APCA-API-KEY-ID': ALPACA_API_KEY,
                'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
            },
            params: {
                start: startDate, // Start date for data retrieval
                timeframe: '30Min', // Interval for bars (30-minute data)
            },
        });

        return response.data.bars.map(bar => ({
            symbol,
            time: bar.t,
            close: bar.c, // Closing price
        }));
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error.message);
        return [];
    }
}

// Calculate confidence level and adjust quantity based on historical trade performance
function calculateConfidenceAndQuantity(symbol, shortSMA, longSMA, predictionLog) {
    const symbolLogs = predictionLog.filter(entry => entry.symbol === symbol);

    // Calculate the success rate
    const correctnessLog = symbolLogs.filter(entry => entry.correctness !== "N/A");
    const correctCount = correctnessLog.filter(entry => entry.correctness === "Correct").length;
    const accuracy = correctnessLog.length > 0 ? (correctCount / correctnessLog.length) * 100 : 50; // Default to 50%

    // Calculate profitability
    let profitability = 0;
    if (symbolLogs.length > 0) {
        const totalProfit = symbolLogs.reduce((sum, entry) => sum + (entry.profit || 0), 0);
        profitability = totalProfit / symbolLogs.length;
    }
    const profitabilityPercentage = Math.min(100, Math.max(-100, profitability * 100));

    // Calculate gap strength
    const gapStrength = Math.abs(shortSMA - longSMA) / shortSMA;

    // Combine metrics
    const confidence = (accuracy + gapStrength * 100 + profitabilityPercentage) / 3;

    // Map confidence to quantity
    const quantity = Math.round(Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, confidence * 10)));
    console.log(`Symbol: ${symbol} | Confidence: ${confidence.toFixed(2)}% | Quantity: ${quantity}`);
    return { confidence, quantity };
}

// Submit order to Alpaca
async function submitOrder(symbol, qty, side) {
    try {
        const response = await axios.post(
            `${PAPER_BASE_URL}/v2/orders`,
            { symbol, qty, side, type: 'market', time_in_force: 'gtc' },
            {
                headers: {
                    'APCA-API-KEY-ID': ALPACA_API_KEY,
                    'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
                },
            }
        );
        console.log(`Order Placed: ${side.toUpperCase()} ${qty} shares of ${symbol}`);
        return response.data;
    } catch (error) {
        console.error(`Error placing order for ${symbol}:`, error.message);
    }
}

// Evaluate past trade outcomes
function evaluateTradeOutcomes() {
    const predictionLog = JSON.parse(fs.existsSync(PREDICTION_LOG_FILE) ? fs.readFileSync(PREDICTION_LOG_FILE, 'utf8') : "[]");
    const updatedLog = predictionLog.map(entry => {
        if (entry.finalRecommendation === "Buy" || entry.finalRecommendation === "Sell") {
            // Simulate fetching the latest price for the stock
            const latestPrice = entry.price * (1 + (Math.random() - 0.5) * 0.1); // Replace with real data
            const percentageChange = ((latestPrice - entry.price) / entry.price) * 100;

            const isCorrect = (entry.finalRecommendation === "Buy" && percentageChange > 0) ||
                (entry.finalRecommendation === "Sell" && percentageChange < 0);
            const profit = (latestPrice - entry.price) * (entry.finalRecommendation === "Buy" ? 1 : -1);

            return {
                ...entry,
                correctness: isCorrect ? "Correct" : "Incorrect",
                profit: profit.toFixed(2),
                percentageChange: percentageChange.toFixed(2),
            };
        }
        return entry;
    });

    fs.writeFileSync(PREDICTION_LOG_FILE, JSON.stringify(updatedLog, null, 2));
    console.log("Trade outcomes evaluated and updated in log.");
}

// Generate predictions and place trades
async function generatePredictions() {
    const startDate = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
    const predictionLog = fs.existsSync(PREDICTION_LOG_FILE) ? JSON.parse(fs.readFileSync(PREDICTION_LOG_FILE, 'utf8')) : [];

    for (const symbol of stockSymbols) {
        console.log(`Fetching data for ${symbol}...`);
        const data = await fetchIntradayData(symbol, startDate);

        if (data.length < 10) {
            console.log(`Not enough data for ${symbol}.`);
            continue;
        }

        const shortSMA = data.slice(-5).reduce((sum, d) => sum + d.close, 0) / 5;
        const longSMA = data.slice(-10).reduce((sum, d) => sum + d.close, 0) / 10;
        const latestClose = data[data.length - 1].close;

        const initialRecommendation =
            shortSMA > longSMA ? "Buy" : shortSMA < longSMA ? "Sell" : "Hold";

        const { confidence, quantity } = calculateConfidenceAndQuantity(symbol, shortSMA, longSMA, predictionLog);

        if (initialRecommendation === "Buy") {
            await submitOrder(symbol, quantity, "buy");
        } else if (initialRecommendation === "Sell") {
            await submitOrder(symbol, quantity, "sell");
        }

        const newLogEntry = {
            symbol,
            finalRecommendation: initialRecommendation,
            price: latestClose,
            time: new Date().toISOString(),
            correctness: "N/A",
            profit: 0,
            percentageChange: "N/A",
        };
        predictionLog.push(newLogEntry);
    }

    fs.writeFileSync(PREDICTION_LOG_FILE, JSON.stringify(predictionLog, null, 2));
    console.log('Predictions saved and trades executed.');
}

// Main function
async function main() {
    await generatePredictions();
    setInterval(async () => {
        if (isTimeBetween930And4()) {
            console.log('\nRefreshing data, running predictions, and placing trades...');
            await generatePredictions();
            evaluateTradeOutcomes();
        }
    }, 20 * 60 * 1000); // 20 minutes
}

main();
