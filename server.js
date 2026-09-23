require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const SHEET_ID = '1MOFoH9H0u9PC-w_-ZpE5yfc4QpbdFui2lI_uoZtedt4';

// Autenticação Segura
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

// Limpeza geral para nomes de itens
function sanitize(str) {
    if (!str) return '';
    return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

// Limpador super seguro para Número de Processo
function cleanProc(str) {
    if (!str) return '';
    let s = String(str).trim();
    s = s.replace(/,0+$/, '').replace(/\.0+$/, '');
    return sanitize(s);
}

// O NOVO PARSE NUMBER INTELIGENTE (Resolve o bug do 2.575)
function parseNumber(str) {
    if (str === null || str === undefined || str === '') return 0;
    if (typeof str === 'number') return str;
    
    let s = String(str).trim();
    // Remove tudo que não for dígito, ponto ou vírgula
    s = s.replace(/[^\d.,]/g, ''); 
    
    if (s.includes(',') && s.includes('.')) {
        // Tem os dois: descobre qual é o decimal e qual é a casa de milhar
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        if (lastComma > lastDot) {
            // Formato BR: 1.234,56
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            // Formato US: 1,234.56
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        // Apenas vírgula: 1234,56 -> 1234.56
        s = s.replace(',', '.');
    } else if (s.includes('.')) {
        // Apenas ponto: 2.575 (milhar) ou 12.50 (decimal)
        const parts = s.split('.');
        const lastPart = parts[parts.length - 1];
        // Se tiver exatamente 3 dígitos após o último ponto, é casa de milhar no Brasil (ex: 2.575)
        if (lastPart.length === 3) {
            s = s.replace(/\./g, ''); // Remove o ponto
        }
        // Se for diferente de 3 (ex: 12.50 ou 12.5), mantém o ponto pois é decimal
    }
    
    return parseFloat(s) || 0;
}

function mapRows(rows) {
    if (!rows || rows.length === 0) return [];
    const headers = rows[0].map(sanitize);
    return rows.slice(1).map(row => {
        let obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
    });
}

function getCol(row, possibleNames) {
    for (let name of possibleNames) {
        if (row[name] !== undefined && row[name] !== '') return row[name];
    }
    return '';
}

const targets = [
    { fundef: 1, processo: '202456010136590', item: 'CARTEIRA ESCOLAR' },
    { fundef: 1, processo: '202456010136590', item: 'CJ. ALUNO' },
    { fundef: 1, processo: '202456010136591', item: 'CJ. REFEITÓRIO' },
    { fundef: 1, processo: '202456010136591', item: 'CJ. PROFESSOR' },
    { fundef: 1, processo: '202456010136591', item: 'CADEIRA FIXA EM POLIPROPILENO' },
    { fundef: 1, processo: '202456010136591', item: 'LONGARINA' },
    { fundef: 2, processo: '202656010134023', item: 'CJ. ALUNO TAM 6' },
    { fundef: 2, processo: '202656010134023', item: 'CJ. REFEITÓRIO 8 LUGARES' },
    { fundef: 2, processo: '202656010134023', item: 'ESTANTE ABERTA 4 PRATELEIRAS' },
    { fundef: 2, processo: '202656010134023', item: 'ESTANTE ABERTA 8 PRATELEIRAS' }
];

app.get('/', (req, res) => res.render('index', { titulo: 'Dashboard Executivo - Móveis Escolares' }));

app.get('/api/dados', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.batchGet({
            spreadsheetId: SHEET_ID,
            ranges: ['DEMANDAS!A:Z', 'ENTREGAS!A:Z', 'ESTOQUE!A:Z', 'PRODUCAO!A:Z']
        });

        const demandas = mapRows(response.data.valueRanges[0].values);
        const entregas = mapRows(response.data.valueRanges[1].values);
        const estoque = mapRows(response.data.valueRanges[2].values);
        const producao = mapRows(response.data.valueRanges[3].values);

        const dashboardData = targets.map(t => ({
            fundef: t.fundef, processo: t.processo, item: t.item,
            matchKey: cleanProc(t.processo) + "_" + sanitize(t.item),
            qtd_solicitada: 0, preco_orig: 0, preco_reaj: 0,
            eventos_producao: [], eventos_entrega: [], estoque_total: 0
        }));

        const findMatch = (proc, item) => dashboardData.find(d => d.matchKey === (cleanProc(proc) + "_" + sanitize(item)));

        // 1. DEMANDAS
        demandas.forEach(row => {
            const proc = getCol(row, ['NPROCESSO', 'PROCESSO', 'NUMERODOPROCESSO']);
            const item = getCol(row, ['ITEM', 'PRODUTO', 'DESCRICAO']);
            const match = findMatch(proc, item);
            if (match) {
                match.qtd_solicitada += parseNumber(getCol(row, ['TOTALSOLICITADO', 'QUANTIDADE', 'TOTAL']));
                
                const pOrig = parseNumber(getCol(row, ['PRECOUNITARIO', 'PRECO', 'VALOR', 'VALORUNITARIO', 'PRECOUNITARIOORIGINAL']));
                if (pOrig > 0) match.preco_orig = pOrig;

                const pReaj = parseNumber(getCol(row, ['PRECOUNITARIOREAJUSTADO', 'PRECOREAJUSTADO', 'VALORREAJUSTADO']));
                if (pReaj > 0) {
                    match.preco_reaj = pReaj;
                } else if (match.preco_orig > 0) {
                    match.preco_reaj = match.preco_orig; 
                }
            }
        });

        // 2. PRODUCAO
        producao.forEach(row => {
            const proc = getCol(row, ['PROCESSO', 'NPROCESSO', 'NUMERODOPROCESSO']);
            const item = getCol(row, ['PRODUTO', 'ITEM', 'DESCRICAO']);
            const match = findMatch(proc, item);
            if (match) {
                const qtd = parseNumber(getCol(row, ['QUANTIDADE', 'TOTAL', 'QTD', 'QTDE', 'TOTALPRODUZIDO']));
                const dataRaw = getCol(row, ['DATA', 'DATAPRODUCAO', 'DATADEPRODUCAO', 'CRIACAO']);
                if (qtd > 0) match.eventos_producao.push({ data: dataRaw || 'S/D', qtd });
            }
        });

        // 3. ENTREGAS
        entregas.forEach(row => {
            const proc = getCol(row, ['NPROCESSO', 'PROCESSO', 'NUMERODOPROCESSO']);
            const item = getCol(row, ['ITEM', 'PRODUTO', 'DESCRICAO']);
            const match = findMatch(proc, item);
            if (match) {
                const qtd = parseNumber(getCol(row, ['TOTALENTREGUE', 'QUANTIDADE', 'TOTAL', 'QTD']));
                const dataRaw = getCol(row, ['DATA', 'DATAENTREGA', 'DATADEENTREGA', 'CRIACAO']);
                if (qtd > 0) match.eventos_entrega.push({ data: dataRaw || 'S/D', qtd });
            }
        });

        // 4. ESTOQUE
        estoque.forEach(row => {
            const proc = getCol(row, ['PROCESSO', 'NPROCESSO', 'NUMERODOPROCESSO']);
            const item = getCol(row, ['PRODUTO', 'ITEM', 'DESCRICAO']);
            const match = findMatch(proc, item);
            if (match) {
                match.estoque_total += parseNumber(getCol(row, ['QUANTIDADEEMESTOQUE', 'QUANTIDADE', 'QTD']));
            }
        });

        res.json(dashboardData);
    } catch (error) {
        console.error("Erro na API:", error);
        res.status(500).json({ error: 'Erro ao processar dados da planilha.' });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => console.log(`\n✅ Servidor rodando! Acesse: http://localhost:${port}\n`));
}

module.exports = app;