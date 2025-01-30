const axios = require('axios');
const fs = require('fs');

const MAIN_API_URL = 'https://chriscastle.com/duckburg_api/api.php'
const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_BASE_URL = 'https://data.alpaca.markets/v2/stocks';
const PREDICTION_LOG_FILE = 'predictions_log.json';
const QUANTITY_MIN = 25;
const QUANTITY_MAX = 100;

const stockSymbols = ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMD', 'AMZN', 'META', 'GOOG', 'NFLX', 'SHOP', 'SQ', 'BA'];


async function symbolExists(symbol,QUANTITY_MIN){
    const response = await axios.get(
                MAIN_API_URL, 
            { 
                params: {
                    mode: "single",
                    symbol: symbol,
                    quantity: QUANTITY_MIN
            }
        }    
    );
    console.log("x", response.data.exists)
    return  response.data.exists === "true" ? true : false;
}

// if (symbolExists("META", 800)){
//     console.log("exists.");
// }
// else{
//     console.log("DOES NOT exist.");
// }

async function updateQuanity(symbol,quantity,buyOrSell){
    if (buyOrSell==="sell"){
        quantity = quantity * -1;
    }
    try {
        const response = await axios.post(
            MAIN_API_URL,
            JSON.stringify({ symbol, quantity }),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            }
        );
    } catch (error) {
        console.error(`Error placing order for ${symbol}:`, error.message);
    }
}
updateQuanity("META",1,"sell")
//curl -X POST https://chriscastle.com/duckburg_api/api.php -H "Content-Type: application/json" -d '{"symbol":"META","quantity":-1}'
