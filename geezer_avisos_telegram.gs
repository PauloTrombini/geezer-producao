/**
 * GEEZER CERVEJARIA — Avisos de produção no Telegram
 * ---------------------------------------------------------------------------
 * Projeto Apps Script INDEPENDENTE (não fica preso a nenhuma planilha).
 * Lê a planilha de produção, monta a lista de tarefas em aberto e manda,
 * uma vez por dia, um resumo para cada responsável no Telegram.
 *
 * As regras aqui são AS MESMAS da aba "Tarefas" do painel. Se mudar uma,
 * mude a outra — senão o robô cobra uma coisa e a tela mostra outra.
 *
 * COMO INSTALAR
 * 1. Acesse script.google.com → Novo projeto.
 * 2. Renomeie o projeto para: Geezer Cervejaria — Avisos Telegram
 * 3. Cole este arquivo inteiro por cima do Code.gs.
 * 4. Menu Configurações do projeto (engrenagem) → Propriedades do script →
 *    Adicionar propriedade:
 *        Nome:  TELEGRAM_TOKEN
 *        Valor: (o token que o @BotFather te deu)
 *    Guarde o token SÓ aqui. Nunca dentro do código.
 * 5. Volte ao editor, escolha a função `testarAgora` e clique em Executar.
 *    O Google vai pedir autorização — aceite. Isso manda o resumo de hoje
 *    só para você, para conferir o texto.
 * 6. Quando estiver satisfeito, execute `instalarGatilhoDiario` uma única vez.
 *    A partir daí ele roda sozinho todo dia no horário configurado.
 *
 * PARA DESLIGAR sem mexer no script: na aba Parametros da planilha, coloque
 * 0 em TELEGRAM ATIVO.
 */

/* ========================= CONFIGURAÇÃO ========================= */

var SHEET_ID = '1PysLxO4MFOk_k1R8neUzIwqNszxE3SxcGH-ofh7eXn4';
var HORA_ENVIO = 8;          // 8h da manhã, no fuso do projeto
var ABA_LOG = 'Avisos_Log';  // criada automaticamente na primeira execução

/* ========================= PONTOS DE ENTRADA ========================= */

/** Roda todo dia pelo gatilho. */
function enviarAvisosDiarios() {
  executar_(false, null);
}

/** Teste manual: monta tudo e manda só para você, sem incomodar a equipe. */
function testarAgora() {
  var resp = lerAba_('Responsaveis');
  var eu = null;
  for (var i = 0; i < resp.length; i++) {
    if (texto_(resp[i]['Telegram Chat ID'])) { eu = texto_(resp[i]['Telegram Chat ID']); break; }
  }
  if (!eu) throw new Error('Nenhum responsável tem Telegram Chat ID preenchido na aba Responsaveis.');
  executar_(true, eu);
}

/** Execute UMA vez para agendar o envio diário. */
function instalarGatilhoDiario() {
  var t = ScriptApp.getProjectTriggers();
  for (var i = 0; i < t.length; i++) {
    if (t[i].getHandlerFunction() === 'enviarAvisosDiarios') ScriptApp.deleteTrigger(t[i]);
  }
  ScriptApp.newTrigger('enviarAvisosDiarios').timeBased().atHour(HORA_ENVIO).everyDays(1).create();
  Logger.log('Gatilho diário criado para as ' + HORA_ENVIO + 'h.');
}

/** Remove o agendamento. */
function removerGatilhoDiario() {
  var t = ScriptApp.getProjectTriggers();
  for (var i = 0; i < t.length; i++) {
    if (t[i].getHandlerFunction() === 'enviarAvisosDiarios') ScriptApp.deleteTrigger(t[i]);
  }
  Logger.log('Gatilho removido.');
}

/* ========================= MOTOR ========================= */

function executar_(teste, chatForcado) {
  var param = lerParametros_();
  if (!teste && numero_(param['TELEGRAM ATIVO']) === 0) {
    Logger.log('TELEGRAM ATIVO = 0 na aba Parametros. Nada enviado.');
    return;
  }

  var tarefas = montarTarefas_(param);
  var porFuncao = {};
  tarefas.forEach(function (t) {
    (porFuncao[t.funcao] = porFuncao[t.funcao] || []).push(t);
  });

  var responsaveis = lerAba_('Responsaveis');
  var porPessoa = {};   // chatId -> { nome, tarefas[] }
  var semDono = [];

  Object.keys(porFuncao).forEach(function (f) {
    var r = null;
    for (var i = 0; i < responsaveis.length; i++) {
      if (chave_(responsaveis[i]['Funcao']) === f &&
          chave_(responsaveis[i]['Ativo']) !== 'NAO') { r = responsaveis[i]; break; }
    }
    var chat = r ? texto_(r['Telegram Chat ID']) : '';
    if (!chat) { semDono.push({ funcao: f, qtd: porFuncao[f].length }); return; }
    var alvo = chatForcado || chat;
    porPessoa[alvo] = porPessoa[alvo] || { nome: texto_(r['Nome']), tarefas: [] };
    porPessoa[alvo].tarefas = porPessoa[alvo].tarefas.concat(porFuncao[f]);
  });

  var log = [];
  Object.keys(porPessoa).forEach(function (chat) {
    var p = porPessoa[chat];
    p.tarefas.sort(function (a, b) { return a.prazo - b.prazo; });
    var msg = montarMensagem_(p.nome, p.tarefas, teste);
    var r = enviarTelegram_(chat, msg);
    log.push([new Date(), p.nome, chat, p.tarefas.length, r.ok ? 'ENVIADO' : 'ERRO: ' + r.erro,
              teste ? 'TESTE' : 'DIARIO']);
    Logger.log((r.ok ? 'OK ' : 'FALHA ') + p.nome + ' (' + p.tarefas.length + ' tarefas)');
  });

  if (semDono.length) {
    var aviso = semDono.map(function (s) { return s.funcao + ' (' + s.qtd + ')'; }).join(', ');
    Logger.log('Funções com tarefa mas sem responsável ativo/Chat ID: ' + aviso);
    log.push([new Date(), '—', '—', 0, 'SEM RESPONSAVEL: ' + aviso, teste ? 'TESTE' : 'DIARIO']);
  }
  if (!Object.keys(porPessoa).length) Logger.log('Nenhuma tarefa para enviar hoje.');

  gravarLog_(log);
}

/** Lista de tarefas em aberto — mesma regra da aba Tarefas do painel. */
function montarTarefas_(param) {
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  var agora = new Date();
  var dEtapa  = param['AVISO ETAPA DIAS']  != null ? numero_(param['AVISO ETAPA DIAS'])  : 2;
  var dCusto  = param['AVISO CUSTO DIAS']  != null ? numero_(param['AVISO CUSTO DIAS'])  : 7;
  var dRotulo = param['AVISO ROTULO DIAS'] != null ? numero_(param['AVISO ROTULO DIAS']) : 15;

  var etapasOrdem = lerEtapas_();
  var receitas    = lerReceitas_();
  var custeadas   = lerCusteadas_();
  var lotes       = lerAba_('Producao');
  var out = [];

  lotes.forEach(function (r) {
    var lote = texto_(r['Lote']);
    if (!lote) return;
    var status = chave_(r['Status']);
    if (status === 'CANCELADO' || status === 'CONCLUIDO') return;

    var inicio = data_(r['Data Inicial']);
    if (!inicio) return;
    var cod  = chave_(r['Codigo']);
    var nome = texto_(r['Nome da Cerveja']) || cod;
    var tanque = texto_(r['Tanque']);

    // Encadeia as etapas a partir da data inicial
    var cron = [], cursor = new Date(inicio);
    receitaDe_(cod, receitas, etapasOrdem).forEach(function (e) {
      var ini = new Date(cursor);
      var fim = new Date(cursor.getTime() + e.dias * 86400000);
      cursor = new Date(fim);
      cron.push({ etapa: e.etapa, rotulo: e.rotulo, ini: ini, fim: fim });
    });
    if (!cron.length) return;
    var envase = cron[cron.length - 1].fim;
    if (agora >= envase) return;   // lote já terminou

    cron.forEach(function (e) {
      if (e.fim <= agora) return;
      if (dias_(hoje, e.ini) > dEtapa) return;
      out.push({ funcao: e.etapa, titulo: e.rotulo + ' — ' + nome,
                 detalhe: 'Lote ' + lote + (tanque ? ' · tanque ' + tanque : ''),
                 prazo: e.ini });
    });

    if (!custeadas[cod] && dias_(hoje, inicio) <= dCusto)
      out.push({ funcao: 'ESTUDO DE CUSTO', titulo: 'Custear ' + nome,
                 detalhe: 'Lote ' + lote + ' começa sem ficha de insumos', prazo: inicio });

    if (dias_(hoje, envase) <= dRotulo) {
      if (chave_(r['Rotulo']) !== 'APROVADO')
        out.push({ funcao: 'ROTULO', titulo: 'Rótulo de ' + nome,
                   detalhe: 'Lote ' + lote + ' · envase em ' + fmt_(envase), prazo: envase });
      if (chave_(r['Material Divulgacao']) !== 'APROVADO')
        out.push({ funcao: 'DIVULGACAO', titulo: 'Divulgação de ' + nome,
                   detalhe: 'Lote ' + lote + ' · envase em ' + fmt_(envase), prazo: envase });
    }
  });

  var h = hoje;
  out.forEach(function (t) { t.dias = dias_(h, t.prazo); });
  return out.sort(function (a, b) { return a.prazo - b.prazo; });
}

function montarMensagem_(nome, tarefas, teste) {
  var atrasadas = tarefas.filter(function (t) { return t.dias < 0; });
  var linhas = [];
  linhas.push('<b>Geezer · tarefas de hoje</b>');
  if (teste) linhas.push('<i>(mensagem de teste)</i>');
  linhas.push('Olá, ' + (nome || 'tudo bem') + '! Você tem <b>' + tarefas.length +
              '</b> tarefa(s) em aberto' + (atrasadas.length ? ', sendo <b>' + atrasadas.length + ' em atraso</b>' : '') + '.');
  linhas.push('');
  tarefas.forEach(function (t) {
    var quando = t.dias < 0 ? '🔴 ' + Math.abs(t.dias) + 'd em atraso'
               : t.dias === 0 ? '🟡 hoje'
               : '🟢 em ' + t.dias + 'd';
    linhas.push(quando + ' — <b>' + escapar_(t.titulo) + '</b>');
    linhas.push('     ' + escapar_(t.detalhe) + ' · prazo ' + fmt_(t.prazo));
  });
  linhas.push('');
  linhas.push('Painel: https://geezer-producao.pages.dev/');
  return linhas.join('\n');
}

/* ========================= TELEGRAM ========================= */

function enviarTelegram_(chatId, texto) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  if (!token) return { ok: false, erro: 'TELEGRAM_TOKEN não configurado nas Propriedades do script' };
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true
      })
    });
    var body = JSON.parse(res.getContentText() || '{}');
    if (body.ok) return { ok: true };
    return { ok: false, erro: body.description || ('HTTP ' + res.getResponseCode()) };
  } catch (e) {
    return { ok: false, erro: String(e) };
  }
}

/* ========================= LEITURA DA PLANILHA ========================= */

function planilha_() { return SpreadsheetApp.openById(SHEET_ID); }

/** Devolve a aba como lista de objetos {coluna: valor}. */
function lerAba_(nome) {
  var aba = planilha_().getSheetByName(nome);
  if (!aba) return [];
  var v = aba.getDataRange().getDisplayValues();
  if (v.length < 2) return [];
  var cab = v[0];
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var o = {}, vazia = true;
    for (var j = 0; j < cab.length; j++) {
      o[cab[j]] = v[i][j];
      if (String(v[i][j] || '').trim()) vazia = false;
    }
    if (!vazia) out.push(o);
  }
  return out;
}

function lerParametros_() {
  var out = {};
  lerAba_('Parametros').forEach(function (r) {
    var p = chave_(r['Parametro']);
    if (p) out[p] = r['Valor'];
  });
  return out;
}

function lerEtapas_() {
  return lerAba_('Etapas')
    .filter(function (r) { return texto_(r['Etapa']); })
    .map(function (r) {
      return {
        etapa: chave_(r['Etapa']),
        rotulo: texto_(r['Etapa']),
        ordem: numero_(r['Ordem']) || 99,
        ocupa: chave_(r['Ocupa Tanque']) !== 'NAO',
        dias: paraDias_(r['Duracao Padrao'], r['Unidade'])
      };
    })
    .sort(function (a, b) { return a.ordem - b.ordem; });
}

function lerReceitas_() {
  var out = {};
  lerAba_('Receitas_Etapas').forEach(function (r) {
    var c = chave_(r['Codigo']), e = chave_(r['Etapa']);
    if (!c || !e) return;
    out[c] = out[c] || {};
    out[c][e] = paraDias_(r['Lead Time'], r['Unidade']);
  });
  return out;
}

/** Cervejas com pelo menos um insumo custeado (quantidade × custo > 0). */
function lerCusteadas_() {
  var tot = {};
  lerAba_('Receitas_Insumos').forEach(function (r) {
    var c = chave_(r['Codigo']);
    if (!c) return;
    var q = numero_(r['Quantidade']) || 0, cu = numero_(r['Custo Unitario']) || 0;
    tot[c] = (tot[c] || 0) + q * cu;
  });
  var out = {};
  Object.keys(tot).forEach(function (c) { if (tot[c] > 0) out[c] = true; });
  return out;
}

function receitaDe_(cod, receitas, etapasOrdem) {
  var rec = receitas[cod];
  var tem = rec && Object.keys(rec).length > 0;
  return etapasOrdem
    .filter(function (e) { return tem ? rec[e.etapa] !== undefined : true; })
    .map(function (e) {
      return { etapa: e.etapa, rotulo: e.rotulo, ocupa: e.ocupa,
               dias: tem ? rec[e.etapa] : e.dias };
    })
    .filter(function (e) { return e.dias > 0; });
}

function gravarLog_(linhas) {
  if (!linhas.length) return;
  var ss = planilha_();
  var aba = ss.getSheetByName(ABA_LOG);
  if (!aba) {
    aba = ss.insertSheet(ABA_LOG);
    aba.appendRow(['Quando', 'Responsavel', 'Chat ID', 'Tarefas', 'Resultado', 'Origem']);
  }
  aba.getRange(aba.getLastRow() + 1, 1, linhas.length, 6).setValues(linhas);
}

/* ========================= UTILITÁRIOS ========================= */

function texto_(v) { return String(v == null ? '' : v).trim(); }

function chave_(v) {
  return texto_(v).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** Aceita "1.234,56" (pt-BR) e "1234.56" (ISO). */
function numero_(v) {
  if (typeof v === 'number') return v;
  var s = texto_(v);
  if (!s) return null;
  s = s.replace(/[^\d,.\-]/g, '');
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function paraDias_(valor, unidade) {
  var v = numero_(valor);
  if (v == null) return 0;
  return chave_(unidade).indexOf('HORA') === 0 ? v / 24 : v;
}

function data_(v) {
  if (v instanceof Date) { var d = new Date(v); d.setHours(0, 0, 0, 0); return d; }
  var s = texto_(v);
  if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

function dias_(a, b) { return Math.round((b - a) / 86400000); }

function fmt_(d) {
  if (!d) return '—';
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

function escapar_(s) {
  return texto_(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
