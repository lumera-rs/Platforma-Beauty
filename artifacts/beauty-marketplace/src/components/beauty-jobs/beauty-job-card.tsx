import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { srLatn } from "date-fns/locale";
import { MapPin, Clock, Eye, MessageSquare, Bookmark, Briefcase, Scissors, Star } from "lucide-react";
import { BeautyJobListing } from "@workspace/api-client-react";
import { OptimizedImage } from "@/components/optimized-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface BeautyJobCardProps {
  job: BeautyJobListing;
  onClickToggleSaved?: (e: React.MouseEvent) => void;
  showSaveButton?: boolean;
}

export function BeautyJobCard({ job, onClickToggleSaved, showSaveButton = true }: BeautyJobCardProps) {
  const isJob = job.type === "job" || job.type === "freelance";
  const TypeIcon = isJob ? Briefcase : Scissors;
  const isOffer = job.intent === "offering";
  const categoryName = job.categoryName || job.categorySlug;
  const isSaved = job.isSaved;
  
  const slugifiedTitle = job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const detailUrl = `/poslovi/${slugifiedTitle || "oglas"}/${job.id}`;

  const intentLabel = isOffer
    ? (job.type === "job" ? "Nudim posao" : job.type === "freelance" ? "Nudim usluge" : "Izdajem")
    : (job.type === "job" ? "Tražim posao" : job.type === "freelance" ? "Tražim angažman" : "Tražim prostor/opremu");

  return (
    <div className="group relative flex flex-col sm:flex-row gap-4 p-4 rounded-xl border bg-card transition-all hover:shadow-md hover:border-primary/20">
      {job.photos && job.photos.length > 0 ? (
        <div className="relative w-full sm:w-48 h-48 sm:h-32 rounded-lg overflow-hidden shrink-0 bg-muted">
          <OptimizedImage
            src={job.photos[0]}
            alt={job.title}
            width={400}
            height={300}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
        </div>
      ) : (
        <div className="relative w-full sm:w-48 h-48 sm:h-32 rounded-lg overflow-hidden shrink-0 bg-secondary/50 flex items-center justify-center text-muted-foreground">
          <TypeIcon className="w-10 h-10 opacity-20" />
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex justify-between items-start gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge variant={isOffer ? "default" : "secondary"} className="text-xs">
                {intentLabel}
              </Badge>
              <Badge variant="outline" className="text-xs font-normal">
                {categoryName}
              </Badge>
              {job.status === "closed" && (
                <Badge variant="destructive" className="text-xs">Zatvoren</Badge>
              )}
            </div>
            <Link href={detailUrl}>
              <h3 className="text-lg font-bold font-serif text-foreground group-hover:text-primary transition-colors line-clamp-1">
                {job.title}
              </h3>
            </Link>
          </div>
          {showSaveButton && onClickToggleSaved && (
            <Button
              variant="ghost"
              size="icon"
              className={`shrink-0 -mt-2 -mr-2 ${isSaved ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClickToggleSaved(e);
              }}
            >
              <Bookmark className={`w-5 h-5 ${isSaved ? 'fill-current' : ''}`} />
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground mt-2">
          <div className="flex items-center gap-1.5">
            <MapPin className="w-4 h-4" />
            <span>{job.city}{job.region ? `, ${job.region}` : ''}</span>
          </div>
          {job.priceAmount != null && (
            <div className="flex items-center gap-1.5 font-medium text-foreground">
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
        </div>

        <div className="mt-auto pt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Pre {formatDistanceToNow(new Date(job.createdAt), { locale: srLatn })}</span>
            <div className="flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" /> {job.viewCount}
            </div>
            {job.contactCount > 0 && (
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5" /> {job.contactCount}
              </div>
            )}
          </div>
          
          <div className="text-sm font-medium text-muted-foreground">
            Od: <span className="text-foreground">{job.authorDisplayName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}