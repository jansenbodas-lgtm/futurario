# Futura Rio · Landing page + CRM de leads

Landing page da **Futura Rio Corretora de Planos de Saúde e Odontológico** (corretora responsável: **Carla Jansen**), feita para tráfego pago e SEO, com:

- Botão de WhatsApp (cabeçalho, flutuante e em todas as seções) que abre um **popup** pedindo **nome, telefone e e-mail**. O lead é salvo e a pessoa segue para o WhatsApp da Carla, **(21) 98379-9691**, com a mensagem já escrita.
- Formulário de cotação no final da página (com tipo de plano e número de vidas).
- **CRM em `/admin`** protegido por senha: lista de leads, status do funil (Novo, Em contato, Cotação enviada, Negociando, Fechado, Perdido), notas, busca, filtros, números do painel, botão para chamar o lead no WhatsApp e exportação em CSV (abre no Excel).
- Origem de cada lead registrada: `utm_source`, `utm_campaign`, `gclid` (Google Ads) e `fbclid` (Meta Ads). Assim você sabe qual campanha gerou cada contato.
- SEO: title e description otimizados, dados estruturados (InsuranceAgency, Person, FAQPage), seção de perguntas frequentes, seção de bairros atendidos, `robots.txt` e `sitemap.xml`.
- Evento **Lead** disparado no Meta Pixel e no Google Ads/GA4 quando os códigos estiverem instalados.
- Roda no **Cloudflare** (Worker + KV).

## Publicar no Cloudflare (Worker "futurario")

Já está configurado no `wrangler.toml`: a página em `public/`, a API em `worker.js` e os leads no KV `futura-rio-leads` (binding `LEADS`). Cada push no `main` faz o deploy automaticamente.

**Senha do painel:** enquanto nenhuma senha for cadastrada, o `/admin` usa a senha provisória **`admin`**. Para trocar, em **Workers & Pages → futurario → Settings → Variables and Secrets**, adicione o Secret `ADMIN_PASSWORD` com a nova senha e clique em Deploy. A chave de sessão é gerada automaticamente e guardada no KV (opcionalmente, defina o Secret `SESSION_SECRET`).

Painel: `https://SEU-DOMINIO/admin`.

Teste local com o simulador do Cloudflare:

```bash
npx wrangler dev --var ADMIN_PASSWORD:teste --var SESSION_SECRET:abc
```


## Negócio Fechado (`/negociofechado`)

Quando um lead vai para **Negócio fechado** no CRM, uma cópia dele é criada automaticamente em `/negociofechado` (senha provisória **`admin1`**; para trocar, cadastre o Secret `FIN_PASSWORD` no Cloudflare). Lá ficam:

- previsão de comissões mês a mês (gráfico e tabela por contrato), separando **parcelas iniciais** e **vitalício**;
- controle de recebimento: clique no valor do mês para marcar como recebido;
- filtros por PF/PJ, operadora e situação; contratos cancelados param de gerar vitalício no mês do cancelamento;
- **Regras de comissão** editáveis por operadora, separadas em PJ e PF (parcelas em % do valor mensal + % de vitalício).

Regras PJ iniciais: Amil, SulAmérica, Bradesco e Porto 100/100/100 + 2% vitalício; Klini 100/100/100 + 4%; Assim 100/100/100 + 5%; Leve 100/50/25/25; MedSênior 100/50/50.

## Checklist antes de ligar o tráfego

| O que | Onde |
|---|---|
| Foto profissional da Carla (`carla-jansen-2026.jpg`/`.webp`, 751×876; use um nome novo a cada troca) | `public/img/` |
| Cores: azul #2B4C7F, azul profundo #0B386F, laranja #FE6E25 | `public/css/style.css` |
| Logo (versão em alta resolução, PNG ou SVG) | `public/img/logo-futura-rio-2026.webp` (troque o nome do arquivo a cada nova versão para não ficar preso no cache) |

| Novos depoimentos do Google | `public/index.html`, seção `#depoimentos` |


| Domínio definitivo | `canonical`, `og:*`, JSON-LD, `robots.txt` e `sitemap.xml` (`planosdesaude.futurariocorretora.com.br`) |

| GA4 (Meta Pixel 433140727818457 e Google Ads AW-854308397 já instalados; rótulo da conversão no Secret `id_google_ads`) | bloco comentado no `<head>` do `public/index.html` |

Depois de publicar, cadastre o site no **Google Search Console**, envie o `sitemap.xml` e coloque o link do site nas duas fichas do Google (Futura Rio e Carla Jansen).
