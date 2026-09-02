export type PopularCourseCandidate = {
  id: string;
  rating: number;
  createdAt: Date;
};

export function selectPopularPublicCourses<T extends PopularCourseCandidate>(
  courses: readonly T[],
  featuredFlags: ReadonlyMap<string, boolean>,
  limit: number,
): T[] {
  return [...courses]
    .sort((a, b) => b.rating - a.rating
      || Number(featuredFlags.get(b.id) ?? false) - Number(featuredFlags.get(a.id) ?? false)
      || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}