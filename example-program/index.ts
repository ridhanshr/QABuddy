#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { JiraClient } from "./jira-client.js";
import { ConfluenceClient, TestCase } from "./confluence-client.js";

// ─── CONFIG FROM ENV ──────────────────────────────────────────────────────────

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || "";
const CONFLUENCE_BASE_URL = process.env.CONFLUENCE_BASE_URL || "";
const JIRA_PAT = process.env.JIRA_PAT || "";
const CONFLUENCE_PAT = process.env.CONFLUENCE_PAT || "";

if (!JIRA_BASE_URL || !JIRA_PAT || !CONFLUENCE_BASE_URL || !CONFLUENCE_PAT) {
  console.error(
    "❌ ERROR: Pastikan environment variables berikut sudah diset:\n" +
      "  JIRA_BASE_URL, JIRA_PAT, CONFLUENCE_BASE_URL, CONFLUENCE_PAT"
  );
  process.exit(1);
}

const jira = new JiraClient(JIRA_BASE_URL, JIRA_PAT);
const confluence = new ConfluenceClient(CONFLUENCE_BASE_URL, CONFLUENCE_PAT);

// ─── MCP SERVER ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "jira-confluence-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ─── TOOL DEFINITIONS ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── JIRA TOOLS ──
    {
      name: "jira_get_my_issues",
      description:
        "Ambil semua Jira issue yang di-assign ke saya (current user). Berguna untuk review pekerjaan harian QA.",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: {
            type: "number",
            description: "Jumlah maksimal issue yang dikembalikan (default: 20)",
          },
        },
      },
    },
    {
      name: "jira_get_sprint_issues",
      description:
        "Ambil semua issue dalam sprint aktif untuk project tertentu. Berguna untuk monitoring progress sprint QA.",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Project key Jira (contoh: QA, PROJ, APP)",
          },
          maxResults: {
            type: "number",
            description: "Jumlah maksimal issue (default: 50)",
          },
        },
        required: ["projectKey"],
      },
    },
    {
      name: "jira_search_issues",
      description:
        "Cari Jira issue menggunakan JQL query. Berguna untuk filter issue spesifik.",
      inputSchema: {
        type: "object",
        properties: {
          jql: {
            type: "string",
            description:
              'JQL query string. Contoh: project = "QA" AND issuetype = Bug AND priority = Critical',
          },
          maxResults: {
            type: "number",
            description: "Jumlah maksimal issue (default: 30)",
          },
        },
        required: ["jql"],
      },
    },
    {
      name: "jira_get_issue",
      description:
        "Ambil detail lengkap satu Jira issue berdasarkan key-nya (contoh: QA-123).",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Jira issue key (contoh: QA-123, PROJ-456)",
          },
        },
        required: ["issueKey"],
      },
    },
    {
      name: "jira_create_bug",
      description:
        "Buat Jira bug report baru dengan format QA standar (environment, steps to reproduce, expected vs actual result).",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: "Project key Jira (contoh: QA, PROJ)",
          },
          summary: {
            type: "string",
            description: "Judul singkat bug (contoh: Tombol Login tidak berfungsi di iOS Safari)",
          },
          stepsToReproduce: {
            type: "string",
            description: "Langkah-langkah untuk mereproduksi bug",
          },
          expectedResult: {
            type: "string",
            description: "Hasil yang diharapkan",
          },
          actualResult: {
            type: "string",
            description: "Hasil yang sebenarnya terjadi",
          },
          environment: {
            type: "string",
            description:
              "Environment tempat bug ditemukan (contoh: iOS 17, Safari 17, Production)",
          },
          priority: {
            type: "string",
            description: "Prioritas bug: Critical, High, Medium, Low",
            enum: ["Critical", "High", "Medium", "Low"],
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Label untuk issue (contoh: ['regression', 'mobile'])",
          },
          components: {
            type: "array",
            items: { type: "string" },
            description: "Komponen yang terdampak",
          },
          assignee: {
            type: "string",
            description: "Username assignee (opsional)",
          },
          description: {
            type: "string",
            description: "Informasi tambahan lainnya",
          },
        },
        required: ["project", "summary"],
      },
    },
    {
      name: "jira_update_status",
      description:
        "Update status/transisi Jira issue (contoh: pindahkan dari 'In Progress' ke 'Done').",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string", description: "Jira issue key (contoh: QA-123)" },
          transitionName: {
            type: "string",
            description: "Nama transisi tujuan (contoh: Done, In Progress, In Review, Reopen)",
          },
        },
        required: ["issueKey", "transitionName"],
      },
    },
    {
      name: "jira_add_comment",
      description: "Tambahkan komentar ke Jira issue.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string", description: "Jira issue key" },
          comment: { type: "string", description: "Isi komentar" },
        },
        required: ["issueKey", "comment"],
      },
    },
    {
      name: "jira_link_issues",
      description: "Buat link/relasi antara dua Jira issue.",
      inputSchema: {
        type: "object",
        properties: {
          sourceKey: { type: "string", description: "Issue key sumber (contoh: QA-123)" },
          targetKey: { type: "string", description: "Issue key tujuan (contoh: PROJ-456)" },
          linkType: {
            type: "string",
            description: "Tipe relasi: Relates, Blocks, Clones (default: Relates)",
          },
        },
        required: ["sourceKey", "targetKey"],
      },
    },
    {
      name: "jira_get_bug_metrics",
      description:
        "Ambil statistik/metrik bug untuk project tertentu: total open, per priority, resolved di sprint ini.",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: { type: "string", description: "Project key Jira" },
        },
        required: ["projectKey"],
      },
    },
    {
      name: "jira_get_projects",
      description: "Ambil daftar semua project Jira yang bisa diakses.",
      inputSchema: { type: "object", properties: {} },
    },

    // ── CONFLUENCE TOOLS ──
    {
      name: "confluence_search_pages",
      description:
        "Cari halaman Confluence berdasarkan keyword. Berguna untuk menemukan test case atau dokumentasi.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Kata kunci pencarian" },
          spaceKey: {
            type: "string",
            description: "Space key Confluence untuk membatasi pencarian (opsional)",
          },
          maxResults: { type: "number", description: "Jumlah maksimal hasil (default: 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "confluence_get_page",
      description: "Ambil konten lengkap satu halaman Confluence berdasarkan page ID.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string", description: "ID halaman Confluence" },
        },
        required: ["pageId"],
      },
    },
    {
      name: "confluence_get_page_by_title",
      description: "Ambil halaman Confluence berdasarkan judul dan space key.",
      inputSchema: {
        type: "object",
        properties: {
          spaceKey: { type: "string", description: "Space key Confluence" },
          title: { type: "string", description: "Judul halaman" },
        },
        required: ["spaceKey", "title"],
      },
    },
    {
      name: "confluence_create_page",
      description: "Buat halaman baru di Confluence.",
      inputSchema: {
        type: "object",
        properties: {
          spaceKey: { type: "string", description: "Space key Confluence" },
          title: { type: "string", description: "Judul halaman" },
          content: {
            type: "string",
            description: "Konten halaman dalam format HTML/Confluence Storage Format",
          },
          parentId: { type: "string", description: "ID halaman parent (opsional)" },
        },
        required: ["spaceKey", "title", "content"],
      },
    },
    {
      name: "confluence_create_test_report",
      description:
        "Buat halaman laporan hasil test execution di Confluence dengan tabel summary (pass/fail/skip) yang sudah terformat.",
      inputSchema: {
        type: "object",
        properties: {
          spaceKey: { type: "string", description: "Space key Confluence" },
          reportTitle: { type: "string", description: "Judul laporan (contoh: Test Report Sprint 23 - Login Feature)" },
          testCases: {
            type: "array",
            description: "Array test case beserta hasilnya",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "ID test case (contoh: TC-001)" },
                name: { type: "string", description: "Nama/deskripsi test case" },
                steps: { type: "array", items: { type: "string" } },
                expectedResult: { type: "string" },
                status: {
                  type: "string",
                  enum: ["PASS", "FAIL", "SKIP", "NOT_RUN"],
                },
                notes: { type: "string", description: "Catatan atau bug ticket (contoh: QA-123)" },
              },
              required: ["id", "name", "expectedResult"],
            },
          },
          parentId: { type: "string", description: "ID parent page (opsional)" },
          jiraProjectUrl: { type: "string", description: "URL project Jira terkait (opsional)" },
        },
        required: ["spaceKey", "reportTitle", "testCases"],
      },
    },
    {
      name: "confluence_get_test_cases",
      description:
        "Ambil dan parse test case dari halaman Confluence yang memiliki tabel test case standar.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string", description: "ID halaman Confluence berisi test case" },
        },
        required: ["pageId"],
      },
    },
    {
      name: "confluence_get_spaces",
      description: "Ambil daftar semua Confluence space yang bisa diakses.",
      inputSchema: { type: "object", properties: {} },
    },

    // ── COMBINED QA TOOLS ──
    {
      name: "qa_daily_summary",
      description:
        "Generate ringkasan harian QA: ambil issue saya + bug metrics dari project tertentu. Cocok untuk standup pagi.",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Project key Jira untuk diambil metriknya",
          },
        },
        required: ["projectKey"],
      },
    },
    {
      name: "qa_release_readiness",
      description:
        "Cek kesiapan release: hitung open bug, critical issues, dan bug yang resolved di sprint aktif.",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: { type: "string", description: "Project key Jira" },
        },
        required: ["projectKey"],
      },
    },
  ],
}));

// ─── TOOL HANDLERS ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── JIRA ──────────────────────────────────────────────────────

      case "jira_get_my_issues": {
        const issues = await jira.getMyIssues(args?.maxResults as number);
        return {
          content: [
            {
              type: "text",
              text: formatIssueList(issues, "📋 Issue Yang Assigned ke Saya"),
            },
          ],
        };
      }

      case "jira_get_sprint_issues": {
        const issues = await jira.getSprintIssues(
          args!.projectKey as string,
          args?.maxResults as number
        );
        return {
          content: [
            {
              type: "text",
              text: formatIssueList(issues, `🏃 Sprint Issues — ${args!.projectKey}`),
            },
          ],
        };
      }

      case "jira_search_issues": {
        const issues = await jira.searchIssues(
          args!.jql as string,
          args?.maxResults as number
        );
        return {
          content: [
            {
              type: "text",
              text: formatIssueList(issues, `🔍 Hasil Pencarian JQL`),
            },
          ],
        };
      }

      case "jira_get_issue": {
        const issue = await jira.getIssue(args!.issueKey as string);
        return {
          content: [{ type: "text", text: formatIssueDetail(issue, JIRA_BASE_URL) }],
        };
      }

      case "jira_create_bug": {
        const result = await jira.createBug(args as any);
        return {
          content: [
            {
              type: "text",
              text: `✅ Bug berhasil dibuat!\n\n🔑 Issue Key: **${result.key}**\n🔗 URL: ${result.url}`,
            },
          ],
        };
      }

      case "jira_update_status": {
        const result = await jira.updateIssueStatus(
          args!.issueKey as string,
          args!.transitionName as string
        );
        return {
          content: [
            {
              type: "text",
              text: result.success ? `✅ ${result.message}` : `❌ ${result.message}`,
            },
          ],
        };
      }

      case "jira_add_comment": {
        const result = await jira.addComment(
          args!.issueKey as string,
          args!.comment as string
        );
        return {
          content: [
            {
              type: "text",
              text: `✅ Komentar ditambahkan ke ${args!.issueKey}\n🔗 ${result.url}`,
            },
          ],
        };
      }

      case "jira_link_issues": {
        await jira.linkIssues(
          args!.sourceKey as string,
          args!.targetKey as string,
          (args?.linkType as string) || "Relates"
        );
        return {
          content: [
            {
              type: "text",
              text: `✅ ${args!.sourceKey} berhasil di-link ke ${args!.targetKey} (${args?.linkType || "Relates"})`,
            },
          ],
        };
      }

      case "jira_get_bug_metrics": {
        const metrics = await jira.getBugMetrics(args!.projectKey as string);
        return {
          content: [{ type: "text", text: formatBugMetrics(metrics, args!.projectKey as string) }],
        };
      }

      case "jira_get_projects": {
        const projects = await jira.getProjects();
        const list = projects.map((p) => `• **${p.key}** — ${p.name}`).join("\n");
        return {
          content: [{ type: "text", text: `📁 Daftar Project Jira:\n\n${list}` }],
        };
      }

      // ── CONFLUENCE ────────────────────────────────────────────────

      case "confluence_search_pages": {
        const pages = await confluence.searchPages(
          args!.query as string,
          args?.spaceKey as string,
          args?.maxResults as number
        );
        const list = pages
          .map(
            (p) =>
              `• **${p.title}** (ID: ${p.id})\n  Space: ${p.space.name}\n  🔗 ${CONFLUENCE_BASE_URL}${p._links.webui}`
          )
          .join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `📄 Hasil Pencarian Confluence (${pages.length} halaman):\n\n${list || "Tidak ada hasil."}`,
            },
          ],
        };
      }

      case "confluence_get_page": {
        const page = await confluence.getPage(args!.pageId as string);
        const bodyText = page.body?.storage.value
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3000);
        return {
          content: [
            {
              type: "text",
              text: `📄 **${page.title}**\nSpace: ${page.space.name} | Version: ${page.version.number}\nURL: ${CONFLUENCE_BASE_URL}${page._links.webui}\n\n---\n${bodyText}${bodyText && bodyText.length >= 3000 ? "\n\n[... konten dipotong, gunakan pageId untuk detail lebih lanjut]" : ""}`,
            },
          ],
        };
      }

      case "confluence_get_page_by_title": {
        const page = await confluence.getPageByTitle(
          args!.spaceKey as string,
          args!.title as string
        );
        if (!page) {
          return {
            content: [{ type: "text", text: `❌ Halaman "${args!.title}" tidak ditemukan di space ${args!.spaceKey}` }],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `📄 Halaman ditemukan!\n\nJudul: **${page.title}**\nID: ${page.id}\nURL: ${CONFLUENCE_BASE_URL}${page._links.webui}`,
            },
          ],
        };
      }

      case "confluence_create_page": {
        const result = await confluence.createPage(
          args!.spaceKey as string,
          args!.title as string,
          args!.content as string,
          args?.parentId as string
        );
        return {
          content: [
            {
              type: "text",
              text: `✅ Halaman berhasil dibuat!\n\nID: ${result.id}\n🔗 ${result.url}`,
            },
          ],
        };
      }

      case "confluence_create_test_report": {
        const result = await confluence.createTestReport(
          args!.spaceKey as string,
          args!.reportTitle as string,
          args!.testCases as TestCase[],
          args?.parentId as string,
          args?.jiraProjectUrl as string
        );
        return {
          content: [
            {
              type: "text",
              text: `✅ Laporan test berhasil dibuat di Confluence!\n\n📄 Judul: ${args!.reportTitle}\n🔗 ${result.url}`,
            },
          ],
        };
      }

      case "confluence_get_test_cases": {
        const page = await confluence.getPage(args!.pageId as string);
        const html = page.body?.storage.value || "";
        const testCases = confluence.parseTestCasesFromHtml(html);
        const list = testCases
          .map(
            (tc) =>
              `• **${tc.id}** — ${tc.name}\n  Status: ${tc.status || "NOT_RUN"} | Expected: ${tc.expectedResult.slice(0, 80)}`
          )
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `🧪 Test Cases dari "${page.title}" (${testCases.length} test case):\n\n${list || "Tidak ada test case ditemukan. Pastikan format tabel sesuai standar."}`,
            },
          ],
        };
      }

      case "confluence_get_spaces": {
        const spaces = await confluence.getSpaces();
        const list = spaces.map((s) => `• **${s.key}** — ${s.name}`).join("\n");
        return {
          content: [{ type: "text", text: `🗂️ Daftar Confluence Space:\n\n${list}` }],
        };
      }

      // ── COMBINED QA TOOLS ──────────────────────────────────────────

      case "qa_daily_summary": {
        const [myIssues, metrics] = await Promise.all([
          jira.getMyIssues(10),
          jira.getBugMetrics(args!.projectKey as string),
        ]);

        const issueList = myIssues
          .slice(0, 5)
          .map((i) => `  • [${i.key}] ${i.fields.summary} (${i.fields.status.name})`)
          .join("\n");

        const summary = `🌅 **Daily QA Summary — ${new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}**

📋 **Issue Saya (${myIssues.length} total):**
${issueList || "  Tidak ada issue aktif"}

🐛 **Bug Metrics — Project ${args!.projectKey}:**
${formatBugMetrics(metrics, args!.projectKey as string)}`;

        return { content: [{ type: "text", text: summary }] };
      }

      case "qa_release_readiness": {
        const metrics = await jira.getBugMetrics(args!.projectKey as string);
        const criticalOpen = metrics["critical"] || 0;
        const highOpen = metrics["high"] || 0;
        const totalOpen = metrics["total_open"] || 0;
        const resolvedSprint = metrics["resolved_this_sprint"] || 0;

        let verdict = "✅ **GO** — Siap untuk release";
        let reason = "Tidak ada critical/high bug yang open.";

        if (criticalOpen > 0) {
          verdict = "🚫 **NO-GO** — Tidak siap release";
          reason = `Masih ada ${criticalOpen} bug Critical yang open.`;
        } else if (highOpen >= 3) {
          verdict = "⚠️ **PERLU REVIEW** — Pertimbangkan ulang";
          reason = `Ada ${highOpen} bug High yang open. Diskusikan dengan tim.`;
        }

        return {
          content: [
            {
              type: "text",
              text: `🚀 **Release Readiness Check — ${args!.projectKey}**\n\n${verdict}\n📌 Alasan: ${reason}\n\n📊 Detail:\n• Total open bugs: ${totalOpen}\n• Critical open: ${criticalOpen}\n• High open: ${highOpen}\n• Resolved sprint ini: ${resolvedSprint}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Tool tidak dikenal: ${name}`);
    }
  } catch (error: any) {
    const msg = error?.response?.data?.errorMessages?.join(", ") ||
      error?.response?.data?.message ||
      error?.message ||
      "Unknown error";
    return {
      content: [{ type: "text", text: `❌ Error: ${msg}` }],
      isError: true,
    };
  }
});

// ─── FORMATTER HELPERS ────────────────────────────────────────────────────────

function formatIssueList(issues: any[], title: string): string {
  if (!issues.length) return `${title}\n\nTidak ada issue ditemukan.`;

  const list = issues
    .map((i) => {
      const priority = i.fields.priority?.name || "-";
      const status = i.fields.status?.name || "-";
      const assignee = i.fields.assignee?.displayName || "Unassigned";
      return `• **[${i.key}]** ${i.fields.summary}\n  Type: ${i.fields.issuetype.name} | Priority: ${priority} | Status: ${status} | Assignee: ${assignee}`;
    })
    .join("\n\n");

  return `${title} (${issues.length} issue)\n\n${list}`;
}

function formatIssueDetail(issue: any, baseUrl: string): string {
  const f = issue.fields;
  const comments = f.comment?.comments
    ?.slice(-3)
    .map((c: any) => `  💬 **${c.author.displayName}**: ${typeof c.body === "string" ? c.body.slice(0, 200) : "[format kompleks]"}`)
    .join("\n") || "  Tidak ada komentar";

  return `📋 **${issue.key} — ${f.summary}**

🔗 URL: ${baseUrl}/browse/${issue.key}
📦 Project: ${f.project.name} (${f.project.key})
🏷️ Type: ${f.issuetype.name}
🎯 Priority: ${f.priority?.name || "-"}
📊 Status: ${f.status.name}
👤 Assignee: ${f.assignee?.displayName || "Unassigned"}
👤 Reporter: ${f.reporter?.displayName || "-"}
🏷️ Labels: ${f.labels?.join(", ") || "-"}
📅 Created: ${new Date(f.created).toLocaleDateString("id-ID")}
📅 Updated: ${new Date(f.updated).toLocaleDateString("id-ID")}

💬 **Komentar Terbaru:**
${comments}`;
}

function formatBugMetrics(metrics: Record<string, number>, projectKey: string): string {
  const passRate =
    metrics["found_this_sprint"] > 0
      ? Math.round((metrics["resolved_this_sprint"] / metrics["found_this_sprint"]) * 100)
      : 0;

  return `🐛 **Bug Metrics — ${projectKey}**

📊 Open Bugs:
  🔴 Critical : ${metrics["critical"]}
  🟠 High     : ${metrics["high"]}
  🟡 Medium   : ${metrics["medium"]}
  🟢 Low      : ${metrics["low"]}
  📌 Total    : ${metrics["total_open"]}

🏃 Sprint Ini:
  Ditemukan : ${metrics["found_this_sprint"]}
  Resolved  : ${metrics["resolved_this_sprint"]}
  Fix Rate  : ${passRate}%`;
}

// ─── START ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Jira & Confluence MCP Server berjalan...");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
