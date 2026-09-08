/**
 * GEEZER CERVEJARIA — Avisos de produção no Telegram
 * ---------------------------------------------------------------------------
 * Projeto Apps Script INDEPENDENTE (não fica preso a nenhuma planilha).
 *
 * São DUAS mensagens diferentes, com donos e horários diferentes:
 *
 *   1. RESUMO DIÁRIO  — uma mensagem só, com o retrato geral da cervejaria
 *      (o que está fermentando, o que começa, o que envasa, tanques livres,
 *      tarefas em aberto e atrasos). Vai para quem estiver cadastrado na
 *      função RESUMO DIARIO. É para quem toca o negócio, não para executar.
 *
 *   2. COBRANÇA POR TAREFA — uma mensagem por pessoa, só com as tarefas
 *      dela, dentro das janelas de antecedência configuradas no painel, e
 *      cada tarefa com a frase do que precisa ser feito.
 *
 * As regras das tarefas aqui são AS MESMAS da aba "Tarefas" do painel. Se
 * mudar uma, mude a outra — senão o robô cobra uma coisa e a tela mostra outra.
 *
 * VOCÊ NÃO PRECISA MEXER AQUI. O gatilho se instala e se conserta sozinho:
 * a cada rodada o script confere se o agendamento ainda existe e o recria se
 * alguém apagou. Quem manda no robô é o PAINEL, aba Tarefas → Envio no
 * Telegram:
 *
 *    TELEGRAM ATIVO       chave geral: desligou, não sai nada
 *    AVISO SO DIAS UTEIS  1 = não manda sábado e domingo
 *    RESUMO ATIVO         liga/desliga só o resumo diário
 *    RESUMO HORA          hora do resumo diário (0 a 23)
 *    COBRANCA ATIVA       liga/desliga só a cobrança por tarefa
 *    AVISO HORA           hora da cobrança por tarefa (0 a 23)
 *    AVISO ETAPA/CUSTO/ROTULO DIAS  janelas de antecedência das cobranças
 *
 * O script devolve o próprio estado para o painel, também na aba Parametros:
 *    ROBO ULTIMA CHECAGEM  carimbo de cada rodada (o "batimento")
 *    ROBO ULTIMO RESUMO    quando saiu o último resumo diário
 *    ROBO ULTIMO ENVIO     quando saiu a última rodada de cobranças
 *
 * A única coisa que mora aqui e não pode morar no painel é o token do bot,
 * em Configurações do projeto → Propriedades do script → TELEGRAM_TOKEN.
 * O painel é uma página pública; token em página pública é token roubado.
 */

/* ========================= CONFIGURAÇÃO ========================= */

var SHEET_ID = '1PysLxO4MFOk_k1R8neUzIwqNszxE3SxcGH-ofh7eXn4';
var HORA_PADRAO = 8;              // usado só se a hora não estiver na planilha
var ABA_LOG = 'Avisos_Log';       // criada automaticamente no primeiro envio
var FUNCAO_RESUMO = 'RESUMO DIARIO';
var PAINEL = 'https://geezer-producao.pages.dev/';

/* ========================= PONTOS DE ENTRADA ========================= */

/**
 * Chamado de hora em hora pelo gatilho. Faz, nessa ordem:
 *   1. garante que o próprio gatilho continua existindo;
 *   2. avisa o painel que está vivo (batimento na aba Parametros);
 *   3. manda o resumo diário, se já deu a hora e ainda não saiu hoje;
 *   4. manda as cobranças, se já deu a hora e ainda não saíram hoje.
 */
function enviarAvisosDiarios() {
  garantirGatilho_();

  var param = lerParametros_();
  var agora = new Date();
  var tz = Session.getScriptTimeZone();
  var hoje = Utilities.formatDate(agora, tz, 'yyyy-MM-dd');
  var carimbo = Utilities.formatDate(agora, tz, 'yyyy-MM-dd HH:mm');

  gravarParametro_('ROBO ULTIMA CHECAGEM', carimbo);

  if (numero_(param['TELEGRAM ATIVO']) === 0) {
    Logger.log('TELEGRAM ATIVO = 0. Robô de pé, mas sem enviar nada.');
    return;
  }

  var dia = agora.getDay();                                     // 0=domingo, 6=sábado
  if (numero_(param['AVISO SO DIAS UTEIS']) === 1 && (dia === 0 || dia === 6)) {
    Logger.log('Fim de semana e AVISO SO DIAS UTEIS = 1. Nada enviado.');
    return;
  }

  var props = PropertiesService.getScriptProperties();

  /* A partir da hora marcada, e não EXATAMENTE nela. O gatilho de hora em
     hora do Google não cai no minuto zero — cai num minuto qualquer, que
     pode até pular uma virada de hora. Com "exatamente às 18h" um pulo
     desses fazia a mensagem do dia simplesmente não sair. Assim a rodada
     seguinte pega o atraso, e a trava por data garante uma vez por dia. */

  // 1) RESUMO DIÁRIO
  var hResumo = param['RESUMO HORA'] != null ? Math.round(numero_(param['RESUMO HORA'])) : HORA_PADRAO;
  if (numero_(param['RESUMO ATIVO']) !== 0 &&
      agora.getHours() >= hResumo &&
      props.getProperty('ULTIMO_RESUMO') !== hoje) {
    var nR = enviarResumo_(false, null);
    /* -1 = ninguém cadastrado ainda. Nesse caso NÃO trava o dia: se a pessoa
       for cadastrada daqui a pouco, o resumo ainda sai hoje. */
    if (nR >= 0) {
      props.setProperty('ULTIMO_RESUMO', hoje);
      gravarParametro_('ROBO ULTIMO RESUMO', carimbo + ' · ' + nR + ' mensagem(ns)');
    }
  }

  // 2) COBRANÇA POR TAREFA
  var hCobr = param['AVISO HORA'] != null ? Math.round(numero_(param['AVISO HORA'])) : HORA_PADRAO;
  if (numero_(param['COBRANCA ATIVA']) !== 0 &&
      agora.getHours() >= hCobr &&
      props.getProperty('ULTIMO_ENVIO') !== hoje) {
    var nC = cobrar_(false, null);
    props.setProperty('ULTIMO_ENVIO', hoje);
    gravarParametro_('ROBO ULTIMO ENVIO', carimbo + ' · ' + nC + ' mensagem(ns)');
  }
}

/** Teste manual da COBRANÇA: manda tudo só para você, sem incomodar a equipe. */
function testarCobrancaAgora() {
  cobrar_(true, primeiroChat_());
}

/** Teste manual do RESUMO DIÁRIO: manda só para você. */
function testarResumoAgora() {
  enviarResumo_(true, primeiroChat_());
}

/** Compatibilidade com o nome antigo. */
function testarAgora() { testarCobrancaAgora(); }

/**
 * Garante que existe UM (e só um) agendamento de hora em hora. Roda em toda
 * rodada e também no `ativarRobo`, então o gatilho se conserta sozinho se
 * alguém apagar. Devolve true se precisou criar.
 *
 * Para DESLIGAR o robô não se mexe aqui: é o TELEGRAM ATIVO do painel.
 */
function garantirGatilho_() {
  try {
    var t = ScriptApp.getProjectTriggers(), achou = 0;
    for (var i = 0; i < t.length; i++) {
      if (t[i].getHandlerFunction() !== 'enviarAvisosDiarios') continue;
      achou++;
      if (achou > 1) ScriptApp.deleteTrigger(t[i]);   // duplicado: descarta
    }
    if (achou) return false;
    ScriptApp.newTrigger('enviarAvisosDiarios').timeBased().everyHours(1).create();
    Logger.log('Gatilho de hora em hora (re)criado.');
    return true;
  } catch (e) {
    Logger.log('Não deu para conferir o gatilho: ' + e);
    return false;
  }
}

/**
 * Único botão desta tela, e só na primeira vez: autoriza o script e deixa o
 * robô de pé. Depois disso tudo é feito pelo painel.
 */
function ativarRobo() {
  garantirGatilho_();
  var agora = new Date();
  gravarParametro_('ROBO ULTIMA CHECAGEM',
    Utilities.formatDate(agora, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
  var p = lerParametros_();
  var hR = p['RESUMO HORA'] != null ? Math.round(numero_(p['RESUMO HORA'])) : HORA_PADRAO;
  var hC = p['AVISO HORA']  != null ? Math.round(numero_(p['AVISO HORA']))  : HORA_PADRAO;
  Logger.log('Robô de pé. Confere a cada hora. Hoje: resumo às ' + hR + 'h, cobranças às ' + hC + 'h. '
           + 'Tudo isso se muda no painel, aba Tarefas → Envio no Telegram.');
}

/* ========================= 1. RESUMO DIÁRIO ========================= */

/** Quem está cadastrado para receber o retrato geral do dia. */
function destinatariosResumo_() {
  var out = [];
  lerAba_('Responsaveis').forEach(function (r) {
    if (chave_(r['Funcao']) !== FUNCAO_RESUMO) return;
    if (chave_(r['Ativo']) === 'NAO') return;
    if (!texto_(r['Telegram Chat ID'])) return;
    out.push({ nome: texto_(r['Nome']), chat: texto_(r['Telegram Chat ID']) });
  });
  return out;
}

function enviarResumo_(teste, chatForcado) {
  var destinos = chatForcado
    ? [{ nome: 'você', chat: chatForcado }]
    : destinatariosResumo_();

  if (!destinos.length) {
    Logger.log('Ninguém cadastrado para receber o resumo diário. '
      + 'Cadastre no painel, aba Tarefas → Quem recebe o resumo diário.');
    return -1;   // não trava o dia: cadastrou depois, ainda sai hoje
  }

  var texto = montarResumo_(lerParametros_(), teste);
  var log = [], ok = 0;
  destinos.forEach(function (d) {
    var r = enviarTelegram_(d.chat, texto);
    if (r.ok) ok++;
    log.push([new Date(), d.nome, d.chat, 1, r.ok ? 'ENVIADO' : 'ERRO: ' + r.erro,
              teste ? 'RESUMO (TESTE)' : 'RESUMO']);
    Logger.log((r.ok ? 'OK ' : 'FALHA ') + 'resumo para ' + d.nome);
  });
  gravarLog_(log);
  return ok;
}

/** O retrato do dia: o que está rodando, o que vem, e o que está travado. */
function montarResumo_(param, teste) {
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  var agora = new Date();
  var lotes = lotesAtivos_();
  var L = [];

  L.push('🍺 <b>Geezer · resumo do dia</b> — ' + fmt_(hoje));
  if (teste) L.push('<i>(mensagem de teste)</i>');
  L.push('');

  /* Em produção agora: já começou e ainda não envasou. */
  var rodando = lotes.filter(function (l) { return l.inicio <= agora && agora < l.envase; });
  L.push('<b>NO TANQUE AGORA</b> — ' + rodando.length + ' lote(s)');
  if (!rodando.length) L.push('  nada em produção.');
  rodando.sort(function (a, b) { return a.envase - b.envase; }).forEach(function (l) {
    var et = etapaAtual_(l, agora);
    var tq = tanqueDoMomento_(l, agora);
    L.push('• <b>' + escapar_(l.nome) + '</b> · ' + escapar_(l.lote)
      + (tq ? ' · ' + escapar_(tq) : '')
      + (et ? '\n     ' + escapar_(et.rotulo) + ' até ' + fmt_(et.fim) : '')
      + '\n     envase previsto ' + fmt_(l.envase));
  });
  L.push('');

  /* Começam nos próximos 7 dias. */
  var vindo = lotes.filter(function (l) {
    return l.inicio > agora && dias_(hoje, l.inicio) <= 7;
  }).sort(function (a, b) { return a.inicio - b.inicio; });
  L.push('<b>COMEÇAM EM ATÉ 7 DIAS</b> — ' + vindo.length);
  if (!vindo.length) L.push('  nenhuma brassagem marcada.');
  vindo.forEach(function (l) {
    L.push('• ' + escapar_(l.nome) + ' · ' + escapar_(l.lote)
      + (l.tanque ? ' · ' + escapar_(l.tanque) : '') + ' — ' + fmt_(l.inicio));
  });
  L.push('');

  /* Envases nos próximos 15 dias. */
  var envases = lotes.filter(function (l) {
    return l.envase >= agora && dias_(hoje, l.envase) <= 15;
  }).sort(function (a, b) { return a.envase - b.envase; });
  L.push('<b>ENVASES EM ATÉ 15 DIAS</b> — ' + envases.length);
  if (!envases.length) L.push('  nenhum envase na janela.');
  envases.forEach(function (l) {
    var pend = [];
    if (l.rotulo !== 'APROVADO') pend.push('rótulo');
    if (l.material !== 'APROVADO') pend.push('divulgação');
    L.push('• ' + escapar_(l.nome) + ' · ' + escapar_(l.lote) + ' — ' + fmt_(l.envase)
      + (pend.length ? '\n     ⚠️ falta ' + pend.join(' e ') : ''));
  });
  L.push('');

  /* Tanques. */
  var tanques = lerAba_('Fermentadores')
    .filter(function (r) { return texto_(r['Tanque']); })
    .filter(function (r) { return chave_(r['Status']) !== 'INATIVO'; });
  if (tanques.length) {
    var ocupados = {};
    rodando.forEach(function (l) {
      var tq = tanqueDoMomento_(l, agora);
      if (tq) ocupados[chave_(tq)] = true;
    });
    var livres = [], cheios = [];
    tanques.forEach(function (t) {
      (ocupados[chave_(t['Tanque'])] ? cheios : livres).push(texto_(t['Tanque']));
    });
    L.push('<b>TANQUES</b> — ' + cheios.length + ' de ' + tanques.length + ' ocupados');
    if (cheios.length) L.push('  ocupados: ' + escapar_(cheios.join(', ')));
    L.push('  livres: ' + (livres.length ? escapar_(livres.join(', ')) : 'nenhum'));
    L.push('');
  }

  /* Tarefas em aberto, agrupadas por função. */
  var tarefas = montarTarefas_(param);
  var atrasadas = tarefas.filter(function (t) { return t.dias < 0; });
  L.push('<b>TAREFAS EM ABERTO</b> — ' + tarefas.length
    + (atrasadas.length ? ', sendo <b>' + atrasadas.length + ' em atraso</b>' : ''));
  if (!tarefas.length) L.push('  nada pendente na janela de cobrança. 👏');

  var responsaveis = lerAba_('Responsaveis');
  var porFuncao = {}, ordem = [];
  tarefas.forEach(function (t) {
    if (!porFuncao[t.funcao]) { porFuncao[t.funcao] = []; ordem.push(t.funcao); }
    porFuncao[t.funcao].push(t);
  });
  var orfas = 0;
  ordem.forEach(function (f) {
    var lista = porFuncao[f];
    var atr = lista.filter(function (t) { return t.dias < 0; }).length;
    var equipe = equipeDe_(responsaveis, f);
    if (!equipe.length) orfas++;
    L.push('• <b>' + escapar_(f) + '</b>: ' + lista.length
      + (atr ? ' (' + atr + ' em atraso)' : '')
      + ' — ' + (equipe.length
          ? escapar_(equipe.map(function (r) { return texto_(r['Nome']); }).join(', '))
          : '⚠️ sem responsável'));
  });
  if (orfas) {
    L.push('');
    L.push('⚠️ <b>' + orfas + ' função(ões) com tarefa e ninguém para cobrar.</b>');
    L.push('Cadastre em Tarefas → Responsáveis por função.');
  }

  L.push('');
  L.push('Painel: ' + PAINEL);
  return L.join('\n');
}

function etapaAtual_(l, agora) {
  for (var i = 0; i < l.cron.length; i++) {
    if (l.cron[i].ini <= agora && agora < l.cron[i].fim) return l.cron[i];
  }
  return null;
}

/**
 * Em que tanque o lote está NESTE momento. Um lote pode começar num
 * fermentador e terminar em outro; antes da etapa de transferência ele ainda
 * ocupa o primeiro, e só depois dela é que o segundo fica ocupado. Marcar os
 * dois o tempo todo faria a cervejaria parecer sem tanque livre.
 */
function tanqueDoMomento_(l, agora) {
  if (l.tanqueFinal && l.transfEtapa) {
    for (var i = 0; i < l.cron.length; i++) {
      if (l.cron[i].etapa !== l.transfEtapa) continue;
      return agora >= l.cron[i].ini ? l.tanqueFinal : l.tanque;
    }
  }
  return l.tanque;
}

/* ========================= 2. COBRANÇA POR TAREFA ========================= */

/** Responsáveis ativos e com Chat ID de uma função. */
function equipeDe_(responsaveis, funcao) {
  var out = [];
  for (var i = 0; i < responsaveis.length; i++) {
    var r = responsaveis[i];
    if (chave_(r['Funcao']) !== chave_(funcao)) continue;
    if (chave_(r['Ativo']) === 'NAO') continue;
    if (!texto_(r['Telegram Chat ID'])) continue;
    out.push(r);
  }
  return out;
}

function cobrar_(teste, chatForcado) {
  var param = lerParametros_();
  var tarefas = montarTarefas_(param);
  var porFuncao = {};
  tarefas.forEach(function (t) {
    (porFuncao[t.funcao] = porFuncao[t.funcao] || []).push(t);
  });

  var responsaveis = lerAba_('Responsaveis');
  var porPessoa = {};   // chatId -> { nome, tarefas[] }
  var semDono = [];

  Object.keys(porFuncao).forEach(function (f) {
    // Uma função pode ter vários responsáveis — todos os ativos recebem.
    var equipe = equipeDe_(responsaveis, f);
    if (!equipe.length) { semDono.push({ funcao: f, qtd: porFuncao[f].length }); return; }

    equipe.forEach(function (r) {
      var alvo = chatForcado || texto_(r['Telegram Chat ID']);
      porPessoa[alvo] = porPessoa[alvo] || { nome: texto_(r['Nome']), tarefas: [] };
      // No modo teste todos caem no mesmo chat; evita repetir a mesma tarefa.
      porFuncao[f].forEach(function (t) {
        if (porPessoa[alvo].tarefas.indexOf(t) < 0) porPessoa[alvo].tarefas.push(t);
      });
    });
  });

  var log = [], enviadas = 0;
  Object.keys(porPessoa).forEach(function (chat) {
    var p = porPessoa[chat];
    p.tarefas.sort(function (a, b) { return a.prazo - b.prazo; });
    var r = enviarTelegram_(chat, montarCobranca_(p.nome, p.tarefas, teste));
    if (r.ok) enviadas++;
    log.push([new Date(), p.nome, chat, p.tarefas.length, r.ok ? 'ENVIADO' : 'ERRO: ' + r.erro,
              teste ? 'COBRANCA (TESTE)' : 'COBRANCA']);
    Logger.log((r.ok ? 'OK ' : 'FALHA ') + p.nome + ' (' + p.tarefas.length + ' tarefas)');
  });

  if (semDono.length) {
    var aviso = semDono.map(function (s) { return s.funcao + ' (' + s.qtd + ')'; }).join(', ');
    Logger.log('Funções com tarefa mas sem responsável ativo/Chat ID: ' + aviso);
    log.push([new Date(), '—', '—', 0, 'SEM RESPONSAVEL: ' + aviso,
              teste ? 'COBRANCA (TESTE)' : 'COBRANCA']);
  }
  if (!Object.keys(porPessoa).length) Logger.log('Nenhuma tarefa para cobrar hoje.');

  gravarLog_(log);
  return enviadas;
}

function montarCobranca_(nome, tarefas, teste) {
  var atrasadas = tarefas.filter(function (t) { return t.dias < 0; });
  var L = [];
  L.push('📋 <b>Geezer · suas tarefas</b>');
  if (teste) L.push('<i>(mensagem de teste)</i>');
  L.push('Olá, ' + escapar_(nome || 'tudo bem') + '! Você tem <b>' + tarefas.length
    + '</b> tarefa(s) em aberto'
    + (atrasadas.length ? ', sendo <b>' + atrasadas.length + ' em atraso</b>' : '') + '.');
  L.push('');
  tarefas.forEach(function (t) {
    var quando = t.dias < 0 ? '🔴 ' + Math.abs(t.dias) + 'd em atraso'
               : t.dias === 0 ? '🟡 para hoje'
               : '🟢 em ' + t.dias + 'd';
    L.push(quando + ' — <b>' + escapar_(t.titulo) + '</b>');
    L.push('     ' + escapar_(t.detalhe) + ' · prazo ' + fmt_(t.prazo));
    L.push('     ➜ ' + escapar_(t.acao));
    L.push('');
  });
  L.push('Painel: ' + PAINEL);
  return L.join('\n');
}

/* ========================= LOTES E TAREFAS ========================= */

/** Lotes vivos, já com o cronograma encadeado a partir da data inicial. */
function lotesAtivos_() {
  var etapasOrdem = lerEtapas_();
  var receitas = lerReceitas_();
  var out = [];

  lerAba_('Producao').forEach(function (r) {
    var lote = texto_(r['Lote']);
    if (!lote) return;
    var status = chave_(r['Status']);
    if (status === 'CANCELADO' || status === 'CONCLUIDO') return;
    var inicio = data_(r['Data Inicial']);
    if (!inicio) return;

    var cod = chave_(r['Codigo']);
    var cron = [], cursor = new Date(inicio);
    receitaDe_(cod, receitas, etapasOrdem).forEach(function (e) {
      var ini = new Date(cursor);
      var fim = new Date(cursor.getTime() + e.dias * 86400000);
      cursor = new Date(fim);
      cron.push({ etapa: e.etapa, rotulo: e.rotulo, ini: ini, fim: fim });
    });
    if (!cron.length) return;

    out.push({
      lote: lote, cod: cod, nome: texto_(r['Nome da Cerveja']) || cod,
      tanque: texto_(r['Tanque']), tanqueFinal: texto_(r['Tanque Final']),
      transfEtapa: chave_(r['Transfere na Etapa']),
      status: status, inicio: inicio, cron: cron, envase: cron[cron.length - 1].fim,
      rotulo: chave_(r['Rotulo']), material: chave_(r['Material Divulgacao'])
    });
  });
  return out;
}

/** Tarefas em aberto — mesma regra da aba Tarefas do painel. */
function montarTarefas_(param) {
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  var agora = new Date();
  var dEtapa  = param['AVISO ETAPA DIAS']  != null ? numero_(param['AVISO ETAPA DIAS'])  : 2;
  var dCusto  = param['AVISO CUSTO DIAS']  != null ? numero_(param['AVISO CUSTO DIAS'])  : 7;
  var dRotulo = param['AVISO ROTULO DIAS'] != null ? numero_(param['AVISO ROTULO DIAS']) : 15;

  var custeadas = lerCusteadas_();
  var out = [];

  lotesAtivos_().forEach(function (l) {
    if (agora >= l.envase) return;                       // lote já terminou
    var ondeVaza = l.tanque ? ' no tanque ' + l.tanque : '';

    l.cron.forEach(function (e) {
      if (e.fim <= agora) return;
      if (dias_(hoje, e.ini) > dEtapa) return;
      out.push({
        funcao: e.etapa,
        titulo: e.rotulo + ' — ' + l.nome,
        detalhe: 'Lote ' + l.lote + (l.tanque ? ' · tanque ' + l.tanque : ''),
        acao: 'Executar ' + e.rotulo + ' do lote ' + l.lote + ondeVaza
            + ', previsto para ' + fmt_(e.ini) + '. Depois atualize o lote no painel.',
        prazo: e.ini
      });
    });

    if (!custeadas[l.cod] && dias_(hoje, l.inicio) <= dCusto)
      out.push({
        funcao: 'ESTUDO DE CUSTO',
        titulo: 'Custear ' + l.nome,
        detalhe: 'Lote ' + l.lote + ' começa sem ficha de insumos',
        acao: 'Cadastrar os insumos e os custos de ' + l.nome + ' no painel (aba Cervejas → '
            + 'ficha de custo). Sem isso o painel não deixa o lote ' + l.lote
            + ' entrar em produção, e ele começa em ' + fmt_(l.inicio) + '.',
        prazo: l.inicio
      });

    if (dias_(hoje, l.envase) <= dRotulo) {
      if (l.rotulo !== 'APROVADO')
        out.push({
          funcao: 'ROTULO',
          titulo: 'Rótulo de ' + l.nome,
          detalhe: 'Lote ' + l.lote + ' · envase em ' + fmt_(l.envase),
          acao: 'Fechar a arte do rótulo de ' + l.nome + ', mandar imprimir e marcar '
              + 'Rotulo = APROVADO no painel. O envase do lote ' + l.lote + ' é em '
              + fmt_(l.envase) + '.',
          prazo: l.envase
        });
      if (l.material !== 'APROVADO')
        out.push({
          funcao: 'DIVULGACAO',
          titulo: 'Divulgação de ' + l.nome,
          detalhe: 'Lote ' + l.lote + ' · envase em ' + fmt_(l.envase),
          acao: 'Preparar a campanha de lançamento de ' + l.nome + ' (posts, fotos, texto) '
              + 'e marcar Material Divulgacao = APROVADO no painel. O envase do lote '
              + l.lote + ' é em ' + fmt_(l.envase) + '.',
          prazo: l.envase
        });
    }
  });

  out.forEach(function (t) { t.dias = dias_(hoje, t.prazo); });
  return out.sort(function (a, b) { return a.prazo - b.prazo; });
}

/* ========================= TELEGRAM ========================= */

function primeiroChat_() {
  var resp = lerAba_('Responsaveis');
  for (var i = 0; i < resp.length; i++) {
    if (texto_(resp[i]['Telegram Chat ID'])) return texto_(resp[i]['Telegram Chat ID']);
  }
  throw new Error('Nenhum responsável tem Telegram Chat ID preenchido na aba Responsaveis. '
    + 'Cadastre alguém no painel, aba Tarefas.');
}

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

/**
 * Escreve (ou atualiza) uma linha da aba Parametros. É por aqui que o robô
 * conta ao painel que está vivo — o painel só lê a planilha, nunca o script.
 */
function gravarParametro_(nome, valor) {
  try {
    var ss = planilha_();
    var aba = ss.getSheetByName('Parametros');
    if (!aba) return;
    var v = aba.getDataRange().getDisplayValues();
    if (!v.length) return;
    var cab = v[0], cP = -1, cV = -1;
    for (var j = 0; j < cab.length; j++) {
      if (chave_(cab[j]) === 'PARAMETRO') cP = j;
      if (chave_(cab[j]) === 'VALOR') cV = j;
    }
    if (cP < 0 || cV < 0) return;
    var alvo = chave_(nome);
    for (var i = 1; i < v.length; i++) {
      if (chave_(v[i][cP]) === alvo) {
        aba.getRange(i + 1, cV + 1).setValue(valor);
        return;
      }
    }
    var linha = new Array(cab.length).fill('');
    linha[cP] = nome; linha[cV] = valor;
    aba.appendRow(linha);
  } catch (e) {
    Logger.log('Não deu para gravar o parâmetro ' + nome + ': ' + e);
  }
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
