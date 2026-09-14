# Minecraft AI Player

Add-on experimental para **Minecraft Bedrock 26.x** que cria jogadores autônomos capazes de coletar recursos, minerar, fabricar equipamentos, construir, caçar, formar alianças, combater e avançar até o Ender Dragon.

[Baixar AI-Players-Bedrock.mcaddon](https://github.com/Vitkkk/Minecraft-AI-player/releases/download/latest/AI-Players-Bedrock.mcaddon)

> Estado atual: **protótipo jogável 0.1.0**. Não é uma skin parada nem um NPC que apenas segue o jogador. Cada agente mantém inventário, memória, estágio de progressão, personalidade, relações e objetivo próprio.

## Compatibilidade

- Minecraft Bedrock estável 26.x;
- Android, Windows e demais plataformas Bedrock que aceitem add-ons;
- `@minecraft/server 2.9.0`;
- `@minecraft/server-ui 2.1.0`;
- sem Beta APIs e sem recursos experimentais obrigatórios.

## Instalação no Android

1. Baixe o arquivo `AI-Players-Bedrock.mcaddon` pelo link acima.
2. Toque no arquivo e escolha abrir com Minecraft.
3. Espere a importação dos dois packs.
4. Ao criar ou editar um mundo, ative **AI Players — Behavior**. O Resource Pack vinculado será carregado junto.
5. Entre no mundo e procure **Invocar Jogador IA** no inventário Criativo.

Também é possível usar:

```mcfunction
/summon aip:player
```

Agentes criados pelo ovo começam independentes e neutros. Agentes criados por `!ai spawn` começam aliados ao jogador que executou o comando.

## Controles

Toque ou clique em um Jogador IA para abrir o painel:

- formar aliança;
- mandar seguir você;
- devolver autonomia;
- guardar uma posição;
- transformar o agente em rival;
- inspecionar o inventário.

Comandos no chat:

| Comando | Ação |
| --- | --- |
| `!ai spawn [1–8]` | Cria agentes aliados |
| `!ai menu` | Abre a lista de agentes |
| `!ai status` | Mostra etapa, ação e recursos |
| `!ai rally` | Chama todos os seus aliados |
| `!ai auto` | Retoma a progressão autônoma |
| `!ai hold` | Manda aliados guardarem a posição |
| `!ai debug` | Liga/desliga o HUD técnico |
| `!ai help` | Exibe a ajuda dentro do jogo |

## O que os agentes fazem

### Sobrevivência e progressão

1. Procuram árvores e quebram troncos com animação e tempo de mineração.
2. Transformam madeira em tábuas e gravetos, fabricam picareta e espada.
3. Procuram pedra ou abrem uma escadaria de mineração.
4. Constroem abrigo compacto, mesa e fornalha, e caçam comida.
5. Procuram carvão e ferro, fundem minério e fabricam escudo, balde e ferramentas.
6. Descendem às camadas profundas, procuram diamante e fazem picareta.
7. Procuram lava/obsidiana e constroem um portal.
8. Exploram o Nether, enfrentam blazes e coletam varas.
9. Caçam Endermen, produzem Olhos do End e iniciam uma expedição.
10. Entram no End, destroem cristais e lutam contra o dragão real.
11. Comemoram e permanecem no mundo após concluir.

### Combate

O cérebro escolhe uma tática a partir de vida, distância, arma, inimigo e quantidade de aliados:

- aproximação em corrida;
- combo corpo a corpo com intervalo de ataque;
- movimento lateral contra inimigos à distância;
- escudo + agachamento contra projéteis;
- bater e recuar contra Creepers;
- arco para alvos distantes e cristais;
- retirada para comer quando a vida fica baixa.

### Vida social

Cada par de agentes mantém confiança própria. Personalidades diplomáticas tendem a cooperar; rivais têm mais chance de criar conflito. Ataques reduzem confiança e podem iniciar uma rivalidade. Equipes impedem fogo amigo e aliados podem enfrentar a mesma ameaça.

### Persistência

Estágio, estatísticas, personalidade, proprietário, equipe e relações usam propriedades persistentes da entidade. Ao morrer, o agente reaparece após cinco segundos, preserva memória e inventário e registra a morte.

## O que é real e o que é adaptação da API

A Bedrock não permite que um add-on invoque uma instância real da classe `Player`. Portanto, o agente é uma **entidade humanoide própria**, visualmente baseada nos modelos/skins vanilla de Steve e Alex.

- Quebra e colocação de blocos alteram o mundo realmente.
- O inventário de 36 slots e os itens coletados são reais.
- Inimigos, Endermen, blazes, cristais e Ender Dragon recebem dano real.
- Crafting e fundição são decisões reproduzidas pelo script, pois mobs não abrem interfaces de crafting.
- O escudo aparece no equipamento e o cérebro entra em postura defensiva; como mobs não possuem o botão “usar item” de um Player, a redução de dano é reproduzida por resistência e knockback.
- A viagem entre dimensões é acionada depois da construção do portal. O agente não usa a rotina interna exclusiva de Player.
- A Script API estável não expõe busca genérica de estruturas para entidades. A “fortaleza” do End é uma expedição determinística que constrói uma sala de portal distante; a batalha posterior acontece no End real.
- Entidades só processam enquanto seus chunks estão na distância de simulação de algum jogador. A memória persiste e a tarefa continua quando o chunk volta a carregar.

Para evitar uma partida permanentemente travada por azar de geração, `GUARANTEE_PROGRESS` cria encontros de blazes/Endermen depois de uma longa busca sem resultado. Isso pode ser desligado em `AIPlayers_BP/scripts/config.js`.

## Desenvolvimento

Validar e empacotar localmente:

```bash
npm test
python3 tools/build.py dist
```

O workflow do GitHub verifica todo JavaScript com `node --check`, executa os testes do cérebro, valida os JSONs e produz o `.mcaddon`. Cada push em `main` atualiza o download da release `latest`.

Arquitetura detalhada: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Licença

Código sob MIT. Nenhuma textura da Mojang é redistribuída; o Resource Pack apenas referencia recursos vanilla existentes na instalação do jogo.
