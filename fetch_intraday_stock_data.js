const axios = require('axios');
const fs = require('fs');

// Alpaca API Credentials
const API_KEY = 'AK5GSLITRI3WZV4MGC70';
const SECRET_KEY = 'jlIbhBmGKYWTRCOiv2f4xHr7bken0bajhYEdVYDP';

// List of stock symbols
const stockSymbols = ['LAAC', 'ALTM', 'ATUS', 'HBI', 'CRK', 'KOS', 'VLY', 'NGD'];

// Function to get today's date in ISO format with time for Alpaca's API
function getTodayISODate() {
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = String(today.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-based
    const day = String(today.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}T00:00:00Z`; // Start of today in UTC
}

// Function to fetch 30-minute interval data for a single stock
async function fetchIntradayData(symbol, startDate, timeframe = '30Min') {
    const baseURL = 'https://data.alpaca.markets/v2/stocks';
    const endpoint = `${baseURL}/${symbol}/bars`;

    try {
        const response = await axios.get(endpoint, {
            headers: {
                'APCA-API-KEY-ID': API_KEY,
                'APCA-API-SECRET-KEY': SECRET_KEY,
            },
            params: {
                start: startDate,
                timeframe: timeframe,
            },
        });

        return response.data.bars.map(bar => ({
            symbol,
            time: bar.t,
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v,
        }));
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error.response?.data || error.message);
        return [];
    }
}

// Main function to fetch intraday data for all stocks
(async function fetchAllIntradayStocks() {
    const startDate = getTodayISODate(); // Current day at midnight UTC
    const timeframe = '30Min';

    let allData = [];

    for (const symbol of stockSymbols) {
        console.log(`Fetching 30-minute data for ${symbol}...`);
        const stockData = await fetchIntradayData(symbol, startDate, timeframe);
        allData = allData.concat(stockData);
    }

    // Save the combined data to a JSON file
    const outputFilePath = 'intraday_stock_data.json';
    fs.writeFileSync(outputFilePath, JSON.stringify(allData, null, 2));

    console.log(`Intraday data saved to ${outputFilePath}`);
})();
