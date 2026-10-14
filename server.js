require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ID único da planilha para todo o sistema
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

// Funções de limpeza
function sanitize(str) {
    if (!str) return '';
    return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function cleanProc(str) {
    if (!str) return '';
    let s = String(str).trim();
    s = s.replace(/,0+$/, '').replace(/\.0+$/, '');
    return sanitize(s);
}

function parseNumber(str) {
    if (str === null || str === undefined || str === '') return 0;
    if (typeof str === 'number') return str;
    
    let s = String(str).trim();
    s = s.replace(/[^\d.,]/g, ''); 
    
    if (s.includes(',') && s.includes('.')) {
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        if (lastComma > lastDot) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    } else if (s.includes('.')) {
        const parts = s.split('.');
        const lastPart = parts[parts.length - 1];
        if (lastPart.length === 3) {
            s = s.replace(/\./g, '');
        }
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

// LISTA DE ITENS DO DASHBOARD (Itens removidos conforme solicitado)
const targets = [
    // --- FUNDEF 1 ---
    { fundef: 1, processo: '202456010136590', item: 'CARTEIRA ESCOLAR' },
    { fundef: 1, processo: '202456010136590', item: 'CJ. ALUNO' },
    { fundef: 1, processo: '202456010136591', item: 'CJ. REFEITÓRIO' },
    { fundef: 1, processo: '202456010136591', item: 'CJ. PROFESSOR' },
    { fundef: 1, processo: '202456010136591', item: 'CADEIRA FIXA EM POLIPROPILENO' },
    { fundef: 1, processo: '202456010136591', item: 'LONGARINA' },
    
    // --- FUNDEF 2 ---
    { fundef: 2, processo: '202656010134023', item: 'CJ. ALUNO TAM 6' },
    { fundef: 2, processo: '202656010134023', item: 'CJ. REFEITÓRIO 8 LUGARES' },
    { fundef: 2, processo: '202656010134023', item: 'ESTANTE ABERTA 4 PRATELEIRAS' },
    { fundef: 2, processo: '202656010134023', item: 'ESTANTE ABERTA 8 PRATELEIRAS' },
    // Nota: CADEIRA GIRATÓRIA do Fundef 2 mantida, pois não estava na sua lista de remoção para o Fundef 2.
    { fundef: 2, processo: '202656010134023', item: 'CADEIRA GIRATÓRIA' }
];

// ======================
// ROTAS DE FRONTEND (EJS)
// ======================
app.get('/', (req, res) => res.render('index', { titulo: 'Dashboard Executivo - Móveis Escolares' }));
app.get('/projecao', (req, res) => res.render('projecao', { titulo: 'Projeção de Produção' }));
app.get('/simulador', (req, res) => res.render('simulador', { titulo: 'Simulador de Insumos' }));

// ======================
// ROTAS DE API
// ======================

// API 1: DASHBOARD PRINCIPAL
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

        demandas.forEach(row => {
            const match = findMatch(getCol(row, ['NPROCESSO', 'PROCESSO', 'NUMERODOPROCESSO']), getCol(row, ['ITEM', 'PRODUTO', 'DESCRICAO']));
            if (match) {
                match.qtd_solicitada += parseNumber(getCol(row, ['TOTALSOLICITADO', 'QUANTIDADE', 'TOTAL']));
                const pOrig = parseNumber(getCol(row, ['PRECOUNITARIO', 'PRECO', 'VALOR', 'VALORUNITARIO', 'PRECOUNITARIOORIGINAL']));
                if (pOrig > 0) match.preco_orig = pOrig;
                const pReaj = parseNumber(getCol(row, ['PRECOUNITARIOREAJUSTADO', 'PRECOREAJUSTADO', 'VALORREAJUSTADO']));
                if (pReaj > 0) match.preco_reaj = pReaj; else if (match.preco_orig > 0) match.preco_reaj = match.preco_orig; 
            }
        });

        producao.forEach(row => {
            const match = findMatch(getCol(row, ['PROCESSO', 'NPROCESSO']), getCol(row, ['PRODUTO', 'ITEM']));
            if (match) {
                const qtd = parseNumber(getCol(row, ['QUANTIDADE', 'TOTAL', 'QTD']));
                const dataRaw = getCol(row, ['DATA', 'DATAPRODUCAO']);
                if (qtd > 0) match.eventos_producao.push({ data: dataRaw || 'S/D', qtd });
            }
        });

        entregas.forEach(row => {
            const match = findMatch(getCol(row, ['NPROCESSO', 'PROCESSO']), getCol(row, ['ITEM', 'PRODUTO']));
            if (match) {
                const qtd = parseNumber(getCol(row, ['TOTALENTREGUE', 'QUANTIDADE', 'TOTAL']));
                const dataRaw = getCol(row, ['DATA', 'DATAENTREGA']);
                if (qtd > 0) match.eventos_entrega.push({ data: dataRaw || 'S/D', qtd });
            }
        });

        estoque.forEach(row => {
            const match = findMatch(getCol(row, ['PROCESSO', 'NPROCESSO']), getCol(row, ['PRODUTO', 'ITEM']));
            if (match) {
                match.estoque_total += parseNumber(getCol(row, ['QUANTIDADEEMESTOQUE', 'QUANTIDADE', 'QTD']));
            }
        });

        res.json(dashboardData);
    } catch (error) {
        console.error("Erro na API de Dados:", error);
        res.status(500).json({ error: 'Erro ao processar dados da planilha.' });
    }
});

// API 2: PROJEÇÃO EVOLUTIVA
app.get('/api/projecao', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'PROJECAO!A:Z'
        });

        const projecaoRaw = mapRows(response.data.values);
        const data = projecaoRaw.map(row => {
            return {
                processo: getCol(row, ['PROCESSO', 'NPROCESSO']),
                produto: getCol(row, ['PRODUTO', 'ITEM']),
                faltante: parseNumber(getCol(row, ['FALTANTENODIA1210', 'FALTANTE'])),
                data_inicio: getCol(row, ['DATAINICIOPROJECAO', 'DATAINICIO', 'INICIO']),
                qtd_semanal: getCol(row, ['QUANTIDADESEMANAL', 'QTDSEMANAL'])
            };
        }).filter(d => d.processo && d.produto && d.data_inicio);

        res.json(data);
    } catch (error) {
        console.error("Erro na API de Projeção:", error);
        res.status(500).json({ error: 'Erro ao ler a aba PROJECAO.' });
    }
});

// API 3: SIMULADOR DE INSUMOS
app.get('/api/simulador', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'SIMULADOR',
        });
        res.json(response.data.values || []);
    } catch (error) {
        console.error('Erro na API do Simulador:', error);
        res.status(500).json({ error: 'Erro ao buscar dados da aba SIMULADOR' });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => console.log(`\n✅ Servidor rodando! Acesse: http://localhost:${port}\n`));
}

module.exports = app;