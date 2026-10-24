import { nullableDate } from "../lib/dates";
import { completionKey, type CarePlanGraph, type CompletionMap } from "./types";

export function serializeCarePlan(plan: CarePlanGraph, completions: CompletionMap) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    status: plan.status,
    notes: plan.notes,
    startDate: nullableDate(plan.startDate),
    endDate: nullableDate(plan.endDate),
    goals: [...plan.goals]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((goal) => goal.text),
    tasks: [...plan.tasks]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((task) => ({
        id: task.id,
        name: task.name,
        frequency: task.frequency,
        description: task.description,
        completedToday: completions.get(completionKey("task", task.id)) === true,
      })),
    medications: [...plan.medications]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((medication) => ({
        id: medication.id,
        medicationName: medication.medicationName,
        dosage: medication.dosage,
        schedule: medication.schedule,
        description: medication.description,
        completedToday: completions.get(completionKey("medication", medication.id)) === true,
      })),
    dietInstructions: [...plan.diet]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((diet) => ({
        id: diet.id,
        meal: diet.meal,
        restrictions: diet.restrictions,
        description: diet.description,
        completedToday: completions.get(completionKey("diet", diet.id)) === true,
      })),
    hygieneInstructions: [...plan.hygiene]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((hygiene) => ({
        id: hygiene.id,
        activity: hygiene.activity,
        frequency: hygiene.frequency,
        description: hygiene.description,
        completedToday: completions.get(completionKey("hygiene", hygiene.id)) === true,
      })),
  };
}
