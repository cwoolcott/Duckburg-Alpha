const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const moment = require('moment-timezone');

const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_BASE_URL = 'https://data.alpaca.markets/v2/stocks';
const PREDICTION_LOG_FILE = 'predictions_log.json';
const DAILY_STOCK_LOG_FILE = 'daily_stock_log.json';
const QUANTITY_MIN = 25;
const QUANTITY_MAX = 100;


// const stockSymbols = ['LAAC', 'ALTM', 'ATUS', 'HBI', 'BAYRY', 'SWGAY', 'CRK', 'KOS', 'VLY', 'NGD'];
//const stockSymbols = ['F', 'T', 'SNDL', 'AAL', 'PLUG', 'BB', 'CHPT', 'WISH', 'SNAP'];
const stockSymbols = ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'TSLA', 'JNJ', 'V', 'BRK.B', 'GOOGL'];
//Update Stock
async function update_stock(symbol, quantity){
    var bodyFormData = new FormData();
    bodyFormData.append('stock_symbol', symbol);
    bodyFormData.append('quantity', quantity);

    try {
        const response = await axios.post(
        "https://chriscastle.com/duckburg_api/api.php", 
        bodyFormData
    );

    } catch (error) {
        console.log(error);
    }
}

//Read Stock
async function read_stock(){

    const results  = await axios.get(
        "https://chriscastle.com/duckburg_api/api.php?stock=1"
    );

    return results.data;
            
}

// Function to check if the current time is between 9:30 AM and 4:00 PM EST
function isTimeBetween930And4() {
    // Get the current time in EST
    const now = moment().tz("America/New_York");

    // Define the start and end times
    const startTime = moment.tz("09:30 AM", "hh:mm A", "America/New_York");
    const endTime = moment.tz("04:00 PM", "hh:mm A", "America/New_York");

    // Check if the current time is between the start and end times
    return now.isBetween(startTime, endTime, null, "[)");
}

// Initialize or reset the daily stock log at the start of each day
// function initializeDailyLog() {
//     const today = new Date().toISOString().split('T')[0];
//     if (!fs.existsSync(DAILY_STOCK_LOG_FILE)) {
//         fs.writeFileSync(DAILY_STOCK_LOG_FILE, JSON.stringify({ date: today, stocks: {} }));
//     }
//     const dailyLog = JSON.parse(fs.readFileSync(DAILY_STOCK_LOG_FILE, 'utf8'));
//     if (dailyLog.date !== today) {
//         // Reset the log for a new day
//         fs.writeFileSync(DAILY_STOCK_LOG_FILE, JSON.stringify({ date: today, stocks: {} }));
//     }
// }


// ChatGPT analysis for final recommendations
async function getChatGPTAnalysis(symbol, indicators, initialRecommendation, confidence) {
    const prompt = `
        You are an AI financial assistant. Analyze the following stock data and provide a final recommendation:
        - Symbol: ${symbol}
        - Indicators: ${JSON.stringify(indicators)}
        - Initial Recommendation: ${initialRecommendation}
        - Confidence Level: ${confidence}%

        Based on this information, provide a single-word recommendation: Buy, Sell, or Hold.
    `;

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 25,
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                },
            }
        );
        const chatGPTRecommendation = response.data.choices[0].message.content.trim();
        console.log(`ChatGPT Recommendation for ${symbol}: ${chatGPTRecommendation}`);
        return chatGPTRecommendation;
    } catch (error) {
        console.error(`Error getting ChatGPT recommendation for ${symbol}:`, error.message);
	console.log(error);
        return 'Hold'; // Default to Hold if analysis fails
    }
}


// Load the daily stock log
// function loadDailyLog() {
//     initializeDailyLog();
//     return JSON.parse(fs.readFileSync(DAILY_STOCK_LOG_FILE, 'utf8'));
// }

// Save the daily stock log
// function saveDailyLog(dailyLog) {
//     fs.writeFileSync(DAILY_STOCK_LOG_FILE, JSON.stringify(dailyLog, null, 2));
// }

// Fetch intraday stock data
async function fetchIntradayData(symbol, startDate) {
    const endpoint = `${DATA_BASE_URL}/${symbol}/bars`;
    try {
        const response = await axios.get(endpoint, {
            headers: {
                'APCA-API-KEY-ID': ALPACA_API_KEY,
                'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
            },
            params: { start: startDate, timeframe: '30Min' },
        });
        return response.data.bars.map(bar => ({
            symbol,
            time: bar.t,
            close: bar.c,
        }));
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error.message);
        return [];
    }
}

// Submit order to Alpaca
async function submitOrder(symbol, qty, side) {
    try {
        const response = await axios.post(
            `${PAPER_BASE_URL}/v2/orders`,
            {
                symbol,
                qty,
                side, // 'buy' or 'sell'
                type: 'market',
                time_in_force: 'gtc',
            },
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

// Calculate confidence level and adjust quantity
function calculateConfidenceAndQuantity(symbol, shortSMA, longSMA, predictionLog) {
    const accuracyLog = predictionLog.filter(entry => entry.symbol === symbol && entry.correctness !== "N/A");
    const correctCount = accuracyLog.filter(entry => entry.correctness === "Correct").length;
    const accuracy = accuracyLog.length > 0 ? (correctCount / accuracyLog.length) * 100 : 50; // Default to 50% if no data

    const gapStrength = Math.abs(shortSMA - longSMA) / shortSMA; // Proportional gap strength
    const confidence = (accuracy + gapStrength * 100) / 2; // Combine accuracy and indicator strength

    // Map confidence to quantity (100 to 1000)
    const quantity = Math.round(Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, confidence * 10)));
    console.log(`Symbol: ${symbol} | Confidence: ${confidence.toFixed(2)}% | Quantity: ${quantity}`);
    return { confidence, quantity };
}

// Generate predictions and place trades
async function generatePredictions() {
    const startDate = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
    const predictionLog = fs.existsSync(PREDICTION_LOG_FILE)
        ? JSON.parse(fs.readFileSync(PREDICTION_LOG_FILE, 'utf8'))
        : [];
    //const dailyLog = loadDailyLog();

    for (const symbol of stockSymbols) {
        console.log(`Fetching data for ${symbol}...`);
        const data = await fetchIntradayData(symbol, startDate);

        if (data.length < 10) {
            console.log(`Not enough data for ${symbol}.`);
            continue;
        }

        // Calculate indicators
        const shortSMA = data.slice(-5).reduce((sum, d) => sum + d.close, 0) / 5;
        const longSMA = data.slice(-10).reduce((sum, d) => sum + d.close, 0) / 10;
        const latestClose = data[data.length - 1].close;

        // Generate recommendation
        const initialRecommendation =
            shortSMA > longSMA ? "Buy" :
            shortSMA < longSMA ? "Sell" : "Hold";

        // Calculate confidence and adjusted quantity
        const { confidence, quantity } = calculateConfidenceAndQuantity(symbol, shortSMA, longSMA, predictionLog);

        // Get final recommendation from ChatGPT
        const indicators = { shortSMA, longSMA, latestClose };
        const finalRecommendation = await getChatGPTAnalysis(symbol, indicators, initialRecommendation, confidence.toFixed(2));

        console.log("------");
        console.log(`Symbol: ${symbol} | Recommendation: ${initialRecommendation} | Close: ${latestClose}`);
        console.log(`Quantity: ${quantity} | FinalRecommendation: ${finalRecommendation}`);
        // Place trade if Buy/Sell
        if (finalRecommendation === "Buy") {
            // Buy stock and update daily log
            await submitOrder(symbol, quantity, "buy");
            update_stock(symbol, quantity);
            //dailyLog.stocks[symbol] = (dailyLog.stocks[symbol] || 0) + quantity;
        } else if (finalRecommendation === "Sell") {
            // Only sell stock if we have previously bought it
            //const ownedQuantity = dailyLog.stocks[symbol] || 0;
            //if (ownedQuantity > 0) {
                //const sellQuantity = Math.min(quantity, ownedQuantity); // Don't sell more than owned
                //const sellQuantity = quantity;
		await submitOrder(symbol, sellQuantity, "sell");
            update_stock(symbol, (sellQuantity * -1));
                //dailyLog.stocks[symbol] -= sellQuantity;
           // } else {
           //     console.log(`Cannot sell ${symbol}. No stocks owned.`);
           // }
        }

        // Log the prediction
        const newLogEntry = {
            symbol,
            finalRecommendation: finalRecommendation,
            price: latestClose,
            time: new Date().toISOString(),
        };
        predictionLog.push(newLogEntry);
    }

    // Save updated logs
    fs.writeFileSync(PREDICTION_LOG_FILE, JSON.stringify(predictionLog, null, 2));
    //saveDailyLog(dailyLog);

    console.log('Predictions saved and trades executed.');
}

// Main function with automation
async function main() {
    //console.log('Starting trading model with dynamic quantities...');
    //initializeDailyLog();
    await generatePredictions();

    // Run every 30 minutes
    setInterval(async () => {
        if (isTimeBetween930And4()) {
            console.log('\nRefreshing data, running predictions, and placing trades...');
            await generatePredictions();
        }
        
    }, 20 * 60 * 1000); // 20 minutes
}

main();
