require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const SHEET_ID = '1MOFoH9H0u9PC-w_-ZpE5yfc4QpbdFui2lI_uoZtedt4';

// ---------------------------------------------------------
// CORREÇÃO DA CHAVE (Evita o erro DECODER routines::unsupported)
// Pega a variável, converte os "\n" literais em quebras de linha reais
// e remove aspas duplas acidentais nas bordas
let myKey = process.env.GOOGLE_PRIVATE_KEY || '';
myKey = myKey.replace(/\\n/g, '\n').replace(/^"|"$/g, '');

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: myKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });
// ---------------------------------------------------------


function sanitizeForMatch(str) {
    if (!str) return '';
    return String(str)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase();
}

function parseNumber(str) {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    let s = str.toString().replace(/[R$\s]/g, '');
    if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    return parseFloat(s) || 0;
}

function mapRowsToObjects(rows) {
    if (!rows || rows.length === 0) return [];
    const headers = rows[0].map(sanitizeForMatch);
    return rows.slice(1).map(row => {
        let obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index] || '';
        });
        return obj;
    });
}

const targets = [
    { fundef: 1, processo: '202456010136590', item: 'CARTEIRA ESCOLAR' },
    { fundef: 1, processo: '202456010136590', item: 'CJ. ALUNO' },
    { fundef: 1, processo: '202456010136591', item: 'CJ. REFEITÓRIO' },
    { fundef: 1, processo: '202456010136591', item: 'CJ. PROFESSOR' },
    { fundef: 1, processo: '202456010136591', item: 'CADEIRA FIXA EM POLIPROPILENO' },
    { fundef: 1, processo: '202456010136591', item: 'LONGARINA' },
    { fundef: 2, processo: '202656010134023', item: 'CJ. ALUNO CIA TAM 6' },
    { fundef: 2, processo: '202656010134023', item: 'CJ. REFEITÓRIO 8 LUGARES' },
    { fundef: 2, processo: '202656010134023', item: 'ESTANTE ABERTA 4 PRATELEIRAS' },
    { fundef: 2, processo: '202656010134023', item: 'ESTANTE ABERTA 8 PRATELEIRAS' }
];

app.get('/', (req, res) => {
    res.render('index', { titulo: 'Dashboard Executivo - Móveis Escolares' });
});

app.get('/api/dados', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.batchGet({
            spreadsheetId: SHEET_ID,
            ranges: ['DEMANDAS!A:Z', 'ENTREGAS!A:Z', 'ESTOQUE!A:Z', 'PRODUCAO!A:Z']
        });

        const demandas = mapRowsToObjects(response.data.valueRanges[0].values);
        const entregas = mapRowsToObjects(response.data.valueRanges[1].values);
        const estoque = mapRowsToObjects(response.data.valueRanges[2].values);
        const producao = mapRowsToObjects(response.data.valueRanges[3].values);

        const dashboardData = targets.map(t => ({
            fundef: t.fundef,
            processo: t.processo,
            item: t.item,
            matchKey: sanitizeForMatch(t.processo) + "_" + sanitizeForMatch(t.item),
            preco_orig: 0,
            preco_reaj: 0,
            eventos_producao: [],
            eventos_entrega: [],
            estoque_total: 0
        }));

        const findMatch = (proc, item) => dashboardData.find(d => d.matchKey === (sanitizeForMatch(proc) + "_" + sanitizeForMatch(item)));

        demandas.forEach(row => {
            const match = findMatch(row.NPROCESSO || row.PROCESSO, row.ITEM || row.PRODUTO || row.DESCRICAO);
            if (match) {
                match.preco_orig = parseNumber(row.PRECOUNITARIO);
                match.preco_reaj = parseNumber(row.PRECOUNITARIOREAJUSTADO || row.PRECOUNITARIO);
            }
        });

        producao.forEach(row => {
            const match = findMatch(row.PROCESSO || row.NPROCESSO, row.PRODUTO || row.ITEM);
            if (match) {
                match.eventos_producao.push({ data: row.DATA || '01/01/2020', qtd: parseNumber(row.QUANTIDADE || row.TOTAL) });
            }
        });

        entregas.forEach(row => {
            const match = findMatch(row.NPROCESSO || row.PROCESSO, row.ITEM || row.PRODUTO);
            if (match) {
                match.eventos_entrega.push({ data: row.DATA || '01/01/2020', qtd: parseNumber(row.TOTALENTREGUE || row.QUANTIDADE) });
            }
        });

        estoque.forEach(row => {
            const match = findMatch(row.PROCESSO || row.NPROCESSO, row.PRODUTO || row.ITEM);
            if (match) {
                match.estoque_total += parseNumber(row.QUANTIDADEEMESTOQUE || row.QUANTIDADE);
            }
        });

        res.json(dashboardData);
    } catch (error) {
        console.error("Erro na API do Google:", error);
        res.status(500).json({ error: 'Erro ao processar dados da planilha.' });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`\n✅ Servidor rodando com Google Auth! Acesse: http://localhost:${port}\n`);
    });
}

module.exports = app;