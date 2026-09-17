const express = require('express');
const cors = require('cors');
const axios = require('axios');
const yahooFinance = require('yahoo-finance2').default;

const app = express();
app.use(cors());
app.use(express.json());

console.log('🚀 Iniciando Portfolio Analytics Backend...');

// Função para puxar dados históricos de ações BR (brapi.dev)
async function getBrapiData(ticker, range = '12mo') {
  try {
    console.log(`📊 Buscando dados de ${ticker} em brapi.dev...`);
    const response = await axios.get(`https://brapi.dev/api/quote/${ticker}`, {
      params: { range, interval: '1d' }
    });

    if (!response.data.results || response.data.results.length === 0) {
      throw new Error(`Sem dados para ${ticker}`);
    }

    const prices = response.data.results[0].historicalDataPrice || [];
    console.log(`✅ ${ticker}: ${prices.length} dias de dados`);

    return prices.map(p => ({
      date: new Date(p.date * 1000).toISOString().split('T')[0],
      close: p.close
    }));
  } catch (error) {
    console.error(`❌ Erro ao buscar ${ticker}:`, error.message);
    return [];
  }
}

// Função para puxar dados históricos de ETFs LSE (yfinance)
async function getYahooFinanceData(ticker, range = '1y') {
  try {
    console.log(`📊 Buscando dados de ${ticker} em yfinance...`);
    const queryOptions = { period: range, interval: '1d' };
    const result = await yahooFinance.historical(ticker, queryOptions);

    console.log(`✅ ${ticker}: ${result.length} dias de dados`);

    return result.map(r => ({
      date: r.date.toISOString().split('T')[0],
      close: r.close
    }));
  } catch (error) {
    console.error(`❌ Erro ao buscar ${ticker}:`, error.message);
    return [];
  }
}

// Endpoint: obter dados históricos de múltiplos ativos
app.post('/api/portfolio-data', async (req, res) => {
  const { assets, period = '12mo' } = req.body;

  console.log(`\n📥 Requisição recebida: ${assets.length} ativos, período ${period}`);

  if (!assets || !Array.isArray(assets)) {
    return res.status(400).json({ error: 'assets deve ser um array' });
  }

  const results = {};
  const periodMap = {
    '1mo': '1mo',
    '3mo': '3mo',
    '6mo': '6mo',
    '12mo': '1y',
    '5y': '5y'
  };

  const yahooFiPeriod = periodMap[period] || '1y';

  for (const asset of assets) {
    const { ticker, weight } = asset;
    let data = [];

    if (ticker.includes('.') && ticker.toUpperCase().endsWith('.L')) {
      // ETF LSE (yfinance)
      data = await getYahooFinanceData(ticker, yahooFiPeriod);
    } else {
      // Ação BR (brapi.dev) - adicionar .SA se necessário
      const brapiTicker = ticker.toUpperCase().endsWith('SA') ? ticker : `${ticker}.SA`;
      data = await getBrapiData(brapiTicker.replace('.SA', ''), period);
    }

    results[ticker] = {
      weight,
      prices: data,
      currency: ticker.toUpperCase().endsWith('.L') ? 'GBP' : 'BRL'
    };
  }

  console.log(`✅ Dados coletados para ${Object.keys(results).length} ativos\n`);
  res.json(results);
});

// Endpoint: calcular performance da carteira
app.post('/api/calculate-performance', (req, res) => {
  const { portfolioData } = req.body;

  if (!portfolioData) {
    return res.status(400).json({ error: 'portfolioData é obrigatório' });
  }

  console.log(`\n📈 Calculando performance...`);

  const allDates = new Set();

  // Coletar todas as datas únicas
  Object.values(portfolioData).forEach(asset => {
    asset.prices.forEach(p => allDates.add(p.date));
  });

  const sortedDates = Array.from(allDates).sort();

  if (sortedDates.length === 0) {
    return res.status(400).json({ error: 'Sem dados de preço disponíveis' });
  }

  // Calcular valor normalizado da carteira por data
  const portfolioTimeseries = sortedDates.map(date => {
    let portfolioValue = 0;
    let validAssets = 0;

    Object.entries(portfolioData).forEach(([ticker, asset]) => {
      const priceAtDate = asset.prices.find(p => p.date === date);
      if (priceAtDate) {
        portfolioValue += priceAtDate.close * asset.weight;
        validAssets++;
      }
    });

    return {
      date,
      value: portfolioValue,
      validAssets
    };
  });

  // Calcular retorno total
  const firstValue = portfolioTimeseries[0].value;
  const lastValue = portfolioTimeseries[portfolioTimeseries.length - 1].value;
  const totalReturn = ((lastValue - firstValue) / firstValue) * 100;

  // Calcular retorno por ativo
  const assetReturns = {};
  Object.entries(portfolioData).forEach(([ticker, asset]) => {
    if (asset.prices.length > 0) {
      const firstPrice = asset.prices[0].close;
      const lastPrice = asset.prices[asset.prices.length - 1].close;
      const returnPct = ((lastPrice - firstPrice) / firstPrice) * 100;
      assetReturns[ticker] = {
        weight: asset.weight,
        returnPct: returnPct.toFixed(2),
        firstPrice: firstPrice.toFixed(2),
        lastPrice: lastPrice.toFixed(2)
      };
    }
  });

  console.log(`✅ Performance calculada: ${totalReturn.toFixed(2)}%\n`);

  res.json({
    totalReturn: totalReturn.toFixed(2),
    startDate: sortedDates[0],
    endDate: sortedDates[sortedDates.length - 1],
    timeseries: portfolioTimeseries,
    assetReturns,
    portfolioValue: lastValue.toFixed(2)
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ Backend rodando em http://localhost:${PORT}`);
  console.log(`📊 Endpoints disponíveis:`);
  console.log(`   POST /api/portfolio-data`);
  console.log(`   POST /api/calculate-performance`);
  console.log(`   GET /health\n`);
});
