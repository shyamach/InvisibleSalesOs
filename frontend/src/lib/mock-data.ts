export const dashboardMetrics = [
  {
    title: "Total Leads",
    value: "2,847",
    change: "+12.4%",
    trend: "up" as const,
    description: "vs. prior 30 days",
  },
  {
    title: "Automated Replies",
    value: "18,392",
    change: "+8.1%",
    trend: "up" as const,
    description: "across all channels",
  },
  {
    title: "Estimated Revenue Attributed",
    value: "$284,500",
    change: "+21.7%",
    trend: "up" as const,
    description: "pipeline-weighted",
  },
];

export const inquiriesChartData = Array.from({ length: 30 }, (_, i) => {
  const day = i + 1;
  const inquiries = Math.floor(45 + Math.sin(i / 4) * 18 + i * 1.2 + ((i * 7) % 12));
  const conversions = Math.floor(inquiries * (0.18 + Math.sin(i / 6) * 0.06));
  return {
    day: `Day ${day}`,
    inquiries,
    conversions,
  };
});

export const recentAssets = [
  {
    id: "1",
    name: "Q2_Product_Catalog.pdf",
    type: "PDF",
    size: "4.2 MB",
    uploadedAt: "2 hours ago",
    status: "Processed",
  },
  {
    id: "2",
    name: "enterprise_leads_march.csv",
    type: "CSV",
    size: "128 KB",
    uploadedAt: "5 hours ago",
    status: "Processed",
  },
  {
    id: "3",
    name: "product_showcase_hero.jpg",
    type: "Image",
    size: "2.8 MB",
    uploadedAt: "Yesterday",
    status: "Processing",
  },
  {
    id: "4",
    name: "pricing_matrix_v3.csv",
    type: "CSV",
    size: "64 KB",
    uploadedAt: "Yesterday",
    status: "Processed",
  },
  {
    id: "5",
    name: "brand_assets_pack.zip",
    type: "Archive",
    size: "18.5 MB",
    uploadedAt: "2 days ago",
    status: "Processed",
  },
];
