import { Link } from "wouter";
import { differenceInCalendarDays, formatDistanceToNowStrict } from "date-fns";
import { srLatn } from "date-fns/locale";
import {
  MapPin, Eye, Bookmark, Briefcase, Scissors,
  Sparkles, Hand, Brush, PenTool, Building2, Package, MessageSquare
} from "lucide-react";
import { BeautyJobListing } from "@workspace/api-client-react";
import { OptimizedImage } from "@/components/optimized-image";
import { Button } from "@/components/ui/button";

const THEME_COLORS = {
  job: {
    solid: '#378ADD',
    light: '#E6F1FB',
    dark: '#0C447C'
  },
  equipment_rental: {
    solid: '#639922',
    light: '#EAF3DE',
    dark: '#27500A'
  },
  space_rental: {
    solid: '#639922',
    light: '#EAF3DE',
    dark: '#27500A'
  },
  freelance: {
    solid: '#BA7517',
    light: '#FAEEDA',
    dark: '#633806'
  }
} as const;

function getCategoryIcon(type: string, categorySlug: string) {
  if (type === 'space_rental') return Building2;
  if (type === 'equipment_rental') return Package;

  const slug = (categorySlug || "").toLowerCase();
  if (slug.includes('kosa') || slug.includes('friz') || slug.includes('barber')) return Scissors;
  if (slug.includes('nokt') || slug.includes('nail') || slug.includes('manikir') || slug.includes('pedikir')) return Hand;
  if (slug.includes('masaz') || slug.includes('terapeut') || slug.includes('spa')) return Hand;
  if (slug.includes('smink') || slug.includes('makeup')) return Brush;
  if (
    slug.includes('kozmet') ||
    slug.includes('lash') ||
    slug.includes('brow') ||
    slug.includes('pmu') ||
    slug.includes('estet')
  ) return Sparkles;
  if (slug.includes('tetov') || slug.includes('tattoo') || slug.includes('pierc')) return PenTool;

  return Briefcase;
}

function formatCompactDate(dateString: string) {
  try {
    const date = new Date(dateString);
    const calendarDays = differenceInCalendarDays(new Date(), date);

    if (calendarDays <= 0) return "danas";
    if (calendarDays === 1) return "juče";
    if (calendarDays < 7) return `pre ${calendarDays} dana`;
    if (calendarDays < 14) return "pre nedelju dana";

    const distance = formatDistanceToNowStrict(date, { locale: srLatn, addSuffix: true });
    return distance;
  } catch {
    return "";
  }
}

interface BeautyJobCardProps {
  job: BeautyJobListing;
  onClickToggleSaved?: (e: React.MouseEvent) => void;
  showSaveButton?: boolean;
}

export function BeautyJobCard({ job, onClickToggleSaved, showSaveButton = true }: BeautyJobCardProps) {
  const isOffer = job.intent === "offering";
  const categoryName = job.categoryName || job.categorySlug;
  const isSaved = job.isSaved;
  
  const slugifiedTitle = job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const detailUrl = `/poslovi/${slugifiedTitle || "oglas"}/${job.id}`;

  const intentLabel = isOffer
    ? (job.type === "job" ? "Nudim posao" : job.type === "freelance" ? "Nudim usluge" : "Izdajem")
    : (job.type === "job" ? "Tražim posao" : job.type === "freelance" ? "Tražim angažman" : "Tražim prostor/opremu");

  const theme = THEME_COLORS[job.type as keyof typeof THEME_COLORS] || THEME_COLORS.job;

  const intentStyle = isOffer
    ? { backgroundColor: theme.solid, color: '#FFFFFF', borderColor: theme.solid }
    : { backgroundColor: theme.light, color: theme.dark, borderColor: theme.dark };

  const CategoryIcon = getCategoryIcon(job.type, job.categorySlug);

  return (
    <div className="group relative flex flex-col p-4 rounded-xl border bg-card transition-all hover:shadow-md hover:border-primary/20">
      <div className="flex justify-between items-start gap-4">
        <div className="flex min-w-0 gap-3 items-center">
          <div className="w-11 h-11 shrink-0 rounded-[10px] overflow-hidden bg-muted flex items-center justify-center border border-border/50">
            {job.photos && job.photos.length > 0 ? (
              <OptimizedImage
                src={job.photos[0]}
                alt={job.title}
                width={88}
                height={88}
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
              />
            ) : (
              <CategoryIcon className="w-5 h-5 text-muted-foreground/60" />
            )}
          </div>

          <div className="flex flex-col min-w-0">
            <Link href={detailUrl}>
              <h3 className="text-[16px] font-bold font-serif text-foreground group-hover:text-primary transition-colors truncate">
                {job.title}
              </h3>
            </Link>
            <div className="text-[13px] text-muted-foreground truncate -mt-0.5">
              {categoryName}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <div className="flex items-center text-xs text-muted-foreground">
            <span>{formatCompactDate(job.createdAt)}</span>
            <span className="mx-1.5">&middot;</span>
            <div className="flex items-center gap-1" title="Pregledi">
              <Eye className="w-3.5 h-3.5" />
              <span>{job.viewCount}</span>
            </div>
          </div>
          {showSaveButton && onClickToggleSaved && (
            <Button
              variant="ghost"
              size="icon"
              className={`shrink-0 w-8 h-8 -mr-2 -mt-1 ${isSaved ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClickToggleSaved(e);
              }}
            >
              <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase border"
            style={intentStyle}
          >
            {intentLabel}
          </span>
          {job.status === "closed" && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase bg-destructive/10 text-destructive border border-destructive/20">
              Zatvoren
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <MapPin className="w-3.5 h-3.5" />
          <span className="truncate max-w-[150px]">{job.city}{job.region ? `, ${job.region}` : ''}</span>
        </div>

        {job.priceAmount != null && (
          <div className="flex items-center gap-1 text-[13px] font-medium text-foreground">
            <span>
              {job.priceAmount.toLocaleString('sr-RS')} RSD
              {job.pricePeriod ? ` / ${
                job.pricePeriod === 'month' ? 'mes.' :
                job.pricePeriod === 'week' ? 'ned.' :
                job.pricePeriod === 'day' ? 'dan' :
                job.pricePeriod === 'hour' ? 'sat' :
                job.pricePeriod === 'project' ? 'projekat' : 'fiksno'
              }` : ''}
            </span>
            {job.negotiable && <span className="text-muted-foreground font-normal text-xs">(po dogovoru)</span>}
          </div>
        )}

        <div className="ml-auto flex items-center gap-4 text-[13px]">
          {job.contactCount > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground" title="Poruke/kontakti">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{job.contactCount}</span>
            </div>
          )}
          <div className="text-muted-foreground flex items-center gap-1.5">
            Od <span className="font-medium text-foreground">{job.authorDisplayName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
