#!/usr/bin/env node
/**
 * Script de upload de imagens para o Supabase Storage
 * Usa a SERVICE ROLE KEY para criar buckets e fazer upload com permissão total.
 * 
 * Uso: node scripts/upload-images-to-supabase.mjs
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync, readdirSync, statSync } from "fs"
import { join, extname } from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"

// --- Config via .env.local (lidos diretamente) ---
const SUPABASE_URL = "https://cbynwzxalzcaownnouwp.supabase.co"

// Lê a service role key do env (com correção do 'l' extra no início)
const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_service_role_key || ""
// Corrige typo: 'leyJ...' → 'eyJ...'
const SERVICE_ROLE_KEY = rawKey.startsWith("leyJ") ? rawKey.slice(1) : rawKey

if (!SERVICE_ROLE_KEY || !SERVICE_ROLE_KEY.startsWith("eyJ")) {
  // Fallback: usa a key hardcoded correta (sem o 'l' do typo)
  console.warn("⚠️  Usando service role key hardcoded (env não encontrado)")
}

// Service role key corrigida (sem o 'l' inicial)
const FINAL_KEY = SERVICE_ROLE_KEY.startsWith("eyJ")
  ? SERVICE_ROLE_KEY
  : ""

// Service role client — bypass de RLS completo
const supabase = createClient(SUPABASE_URL, FINAL_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const publicDir = join(__dirname, "..", "public", "images")

const UPLOAD_MAP = [
  { localFolder: join(publicDir, "cars"),    bucket: "vehicles", label: "🚗 Carros" },
  { localFolder: join(publicDir, "banners"), bucket: "banners",  label: "🖼️  Banners" },
  { localFolder: join(publicDir, "logos"),   bucket: "logos",    label: "🏢 Logos" },
]

const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"]

function mime(ext) {
  return { ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".gif":"image/gif" }[ext] || "application/octet-stream"
}

async function ensureBucket(bucket) {
  const { data: list } = await supabase.storage.listBuckets()
  if (list?.find(b => b.name === bucket)) {
    console.log(`  ✅ Bucket "${bucket}" já existe.`)
    return true
  }
  console.log(`  🪣  Criando bucket público: "${bucket}"...`)
  const { error } = await supabase.storage.createBucket(bucket, {
    public: true,
    allowedMimeTypes: ["image/*"],
    fileSizeLimit: 15 * 1024 * 1024,
  })
  if (error) {
    console.error(`  ❌ Erro ao criar bucket "${bucket}": ${error.message}`)
    return false
  }
  console.log(`  ✅ Bucket "${bucket}" criado!`)
  return true
}

async function uploadFile(bucket, localPath, remoteName) {
  const ext = extname(localPath).toLowerCase()
  const buf = readFileSync(localPath)
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(remoteName, buf, { contentType: mime(ext), upsert: true, cacheControl: "31536000" })
  if (error) { console.error(`  ❌ ${remoteName}: ${error.message}`); return null }
  return supabase.storage.from(bucket).getPublicUrl(data.path).data.publicUrl
}

async function main() {
  console.log("\n🚀 MICHELINES — Upload de Imagens para Supabase Storage")
  console.log("=".repeat(65))
  console.log(`   Projeto: ${SUPABASE_URL}`)
  console.log(`   Key: service_role (admin)\n`)

  const allResults = []

  for (const { localFolder, bucket, label } of UPLOAD_MAP) {
    console.log(`\n${label}  →  bucket: "${bucket}"`)
    const ok = await ensureBucket(bucket)
    if (!ok) continue

    let files
    try { files = readdirSync(localFolder) }
    catch { console.warn(`  ⚠️  Pasta não encontrada: ${localFolder}`); continue }

    for (const file of files) {
      const localPath = join(localFolder, file)
      if (statSync(localPath).isDirectory()) continue
      const ext = extname(file).toLowerCase()
      if (!ALLOWED_EXT.includes(ext)) continue

      const remoteName = file.replace(/\s+/g, "_").replace(/[()]/g, "").toLowerCase()
      process.stdout.write(`  ⬆️  ${file.padEnd(40)} `)
      const url = await uploadFile(bucket, localPath, remoteName)
      if (url) {
        console.log("✅")
        allResults.push({ bucket, file, remoteName, url })
      }
    }
  }

  // --- RESUMO ---
  console.log("\n" + "=".repeat(65))
  console.log(`\n✅ ${allResults.length} imagens enviadas com sucesso!\n`)

  // Por bucket
  const byBucket = {}
  for (const r of allResults) {
    if (!byBucket[r.bucket]) byBucket[r.bucket] = []
    byBucket[r.bucket].push(r)
  }

  for (const [bucket, items] of Object.entries(byBucket)) {
    console.log(`\n📦 Bucket: ${bucket}`)
    for (const item of items) {
      console.log(`   ${item.remoteName.padEnd(35)} → ${item.url}`)
    }
  }

  // Mapa de carros formatado para seed do Firestore
  const cars = byBucket["vehicles"] || []
  if (cars.length > 0) {
    console.log("\n" + "=".repeat(65))
    console.log("\n🚗 MAPA DE THUMBNAILS (veículos):\n")
    for (const car of cars) {
      const slug = car.remoteName.replace(extname(car.remoteName), "").replace(/_/g, "-")
      console.log(`  "${slug}": "${car.url}"`)
    }
  }

  console.log("\n🏁 Upload concluído!\n")
}

main().catch(err => { console.error("\n❌ Erro crítico:", err.message); process.exit(1) })
