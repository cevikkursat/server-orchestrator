/** deploys ekranlarının metinleri (kaynak dil: Türkçe) */
export default {
  list: {
    descriptionBefore: "Bütün projelerin son ",
    descriptionAfter: " deploy'u",
    refreshEvery: "{{seconds}} sn'de bir yenilenir",
    filterProject: "Projeye göre süz",
    allProjects: "Bütün projeler",
    filterStatus: "Duruma göre süz",
    shownOf: "{{shown}} / {{total}} deploy",
    openLog: "Logu aç",
  },
  filters: {
    all: "Tümü",
    failed: "Başarısız",
    active: "Sürüyor",
    success: "Başarılı",
  },
  empty: {
    title: "Henüz deploy yok",
    body: "Bir projeyi deploy ettiğinizde burada listelenir.",
  },
  noMatch: {
    title: "Süzgeçle eşleşen deploy yok",
    clear: "Filtreyi temizle",
    body: "Son {{limit}} deploy içinde bu proje ve durumla eşleşen kayıt bulunamadı.",
  },
  table: {
    project: "Proje",
    status: "Durum",
    source: "Image / commit",
    trigger: "Tetikleyen",
    duration: "Süre",
  },
} as const;
